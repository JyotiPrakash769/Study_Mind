/* ============================================================
   StudyMind — Application Logic (app.js)
   ============================================================ */

// ── PDF.js worker setup ──────────────────────────────────────
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ── State ────────────────────────────────────────────────────
const State = {
  apiKey: '',
  provider: 'groq',   // 'groq' | 'gemini'
  docText: '',
  topics: [],
  difficulty: 'basic',
  quizQuestions: [],
  quizResults: [],
  performance: { attempts: 0, best: null, history: [], topicScores: {} },
  chatHistory: [],
  voiceEnabled: false,
  speechSynth: window.speechSynthesis || null,
  speaking: false,
};

// ── INIT ─────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const savedProvider = localStorage.getItem('sm_provider') || 'groq';
  setProvider(savedProvider);
  const saved = localStorage.getItem('sm_api_key');
  if (saved) {
    State.apiKey = saved;
    document.getElementById('api-key-input').value = saved;
    showKeyStatus('✅ API key loaded from storage', 'success');
  }
  setupDragDrop();
});

// ── HELPERS ──────────────────────────────────────────────────
function showToast(msg, duration = 3000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), duration);
}

function showLoading(msg = 'Thinking...') {
  document.getElementById('loading-text').textContent = msg;
  document.getElementById('loading-overlay').classList.remove('hidden');
}

function hideLoading() {
  document.getElementById('loading-overlay').classList.add('hidden');
}

function showKeyStatus(msg, type) {
  const el = document.getElementById('key-status');
  el.textContent = msg;
  el.className = 'key-status ' + type;
  el.classList.remove('hidden');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/### (.*?)(\n|$)/g, '<h3>$1</h3>')
    .replace(/## (.*?)(\n|$)/g, '<h2>$1</h2>')
    .replace(/# (.*?)(\n|$)/g, '<h1>$1</h1>')
    .replace(/\n/g, '<br/>');
}

// ── API KEY ───────────────────────────────────────────────────
function setProvider(provider) {
  State.provider = provider;
  localStorage.setItem('sm_provider', provider);
  document.getElementById('btn-groq').classList.toggle('active', provider === 'groq');
  document.getElementById('btn-gemini').classList.toggle('active', provider === 'gemini');
  document.getElementById('groq-instructions').style.display = provider === 'groq' ? '' : 'none';
  document.getElementById('gemini-instructions').style.display = provider === 'gemini' ? '' : 'none';
  const inp = document.getElementById('api-key-input');
  inp.placeholder = provider === 'groq' ? 'Paste your Groq API key here (gsk_...)' : 'Paste your Gemini API key here (AIza...)';
  // Update badge
  document.querySelector('.header-badge').textContent =
    provider === 'groq' ? '✦ Powered by Groq AI — 100% Free, No Credit Card'
                        : '✦ Powered by Google Gemini — Free';
  // Clear saved key when switching providers
  document.getElementById('api-key-input').value = '';
  State.apiKey = '';
  document.getElementById('key-status').className = 'key-status hidden';
}

function toggleKey() {
  const inp = document.getElementById('api-key-input');
  const btn = document.getElementById('show-key-btn');
  if (inp.type === 'password') { inp.type = 'text'; btn.textContent = 'Hide'; }
  else { inp.type = 'password'; btn.textContent = 'Show'; }
}

function saveApiKey() {
  const key = document.getElementById('api-key-input').value.trim();
  const isGroq = State.provider === 'groq';
  if (isGroq && !key.startsWith('gsk_')) {
    showKeyStatus('❌ Invalid Groq key. It should start with "gsk_". Get one free at console.groq.com', 'error');
    return;
  }
  if (!isGroq && !key.startsWith('AIza')) {
    showKeyStatus('❌ Invalid Gemini key. It should start with "AIza". Get one at aistudio.google.com', 'error');
    return;
  }
  State.apiKey = key;
  localStorage.setItem('sm_api_key', key);
  const label = isGroq ? '⚡ Groq API key saved! Llama 3.1 70B ready.' : '✅ Gemini API key saved!';
  showKeyStatus(label, 'success');
  showToast(label);
}

// ── UNIFIED AI CALL (Groq or Gemini) ─────────────────────────
async function callAI(prompt, maxTokens = 2048) {
  if (!State.apiKey) { showToast('⚠️ Please save your API key first!'); throw new Error('No API key'); }
  if (State.provider === 'groq') {
    return await callGroq(prompt, maxTokens);
  } else {
    return await callAI(prompt, maxTokens);
  }
}

async function callGroq(prompt, maxTokens = 2048) {
  const url = 'https://api.groq.com/openai/v1/chat/completions';
  const body = {
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
    temperature: 0.7,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${State.apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || `Groq HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callGemini(prompt, maxTokens = 2048) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${State.apiKey}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 }
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || `Gemini HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ── DOCUMENT LOADING ──────────────────────────────────────────
function setupDragDrop() {
  const zone = document.getElementById('drop-zone');
  zone.addEventListener('dragenter', () => zone.classList.add('dragover'));
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', () => zone.classList.remove('dragover'));
}

function handleDrop(e) {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) processFile(file);
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) processFile(file);
}

async function processFile(file) {
  const info = document.getElementById('file-info');
  info.textContent = `📄 ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  info.classList.remove('hidden');

  if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
    showLoading('Extracting text from PDF...');
    try {
      const buffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
      let text = '';
      for (let i = 1; i <= Math.min(pdf.numPages, 40); i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(item => item.str).join(' ') + '\n';
      }
      document.getElementById('text-input').value = text.trim();
      hideLoading();
      showToast(`✅ Extracted ${pdf.numPages} page(s) from PDF`);
    } catch (err) {
      hideLoading();
      showToast('❌ Error reading PDF: ' + err.message);
    }
  } else if (file.name.endsWith('.txt')) {
    const reader = new FileReader();
    reader.onload = (e) => { document.getElementById('text-input').value = e.target.result; };
    reader.readAsText(file);
    showToast('✅ Text file loaded');
  } else {
    showToast('⚠️ Please upload a PDF or .txt file');
  }
}

async function loadDocument() {
  const text = document.getElementById('text-input').value.trim();
  if (!text || text.length < 50) { showToast('⚠️ Please add some study material first.'); return; }
  if (!State.apiKey) { showToast('⚠️ Please save your API key first!'); return; }

  State.docText = text;
  document.getElementById('load-doc-btn').disabled = true;
  showLoading('Analyzing your document with AI...');

  try {
    // Get summary + topics in one call
    const prompt = `You are an expert study assistant. Analyze the following study material and provide:
1. A comprehensive but concise summary (4-6 sentences).
2. A list of 6-10 key topics/concepts as a JSON array of strings.

Return ONLY valid JSON in this exact format:
{"summary": "...", "topics": ["topic1", "topic2", ...]}

STUDY MATERIAL:
${text.substring(0, 6000)}`;

    const raw = await callAI(prompt, 1024);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Invalid response from AI');

    const parsed = JSON.parse(jsonMatch[0]);
    State.topics = parsed.topics || [];

    // Show results
    document.getElementById('summary-content').innerHTML = formatMarkdown(parsed.summary || 'No summary generated.');
    renderTopics();
    populatePracticeTopic();

    document.getElementById('app-nav').classList.remove('hidden');
    document.getElementById('upload-section').classList.add('hidden');
    document.getElementById('setup-section').classList.add('hidden');
    switchTab('summary');

    hideLoading();
    showToast('✅ Document analyzed! Explore all tabs.');
  } catch (err) {
    hideLoading();
    showToast('❌ Error: ' + err.message);
    document.getElementById('load-doc-btn').disabled = false;
  }
}

function renderTopics() {
  const container = document.getElementById('topics-content');
  container.innerHTML = State.topics.map(t =>
    `<span class="topic-chip" onclick="quickPractice('${escapeHtml(t)}')" title="Click to practice this topic">${escapeHtml(t)}</span>`
  ).join('');
}

function populatePracticeTopic() {
  const sel = document.getElementById('practice-topic');
  sel.innerHTML = State.topics.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
}

// ── TAB NAVIGATION ────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.nav-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.remove('active');
    p.classList.add('hidden');
  });
  const panel = document.getElementById('tab-' + tab);
  if (panel) { panel.classList.remove('hidden'); panel.classList.add('active'); }
}

// ── VOICE SUMMARY ─────────────────────────────────────────────
function speakSummary() {
  if (!State.speechSynth) { showToast('⚠️ Voice not supported in this browser'); return; }
  const summary = document.getElementById('summary-content').textContent;
  if (!summary) return;
  if (State.speaking) { State.speechSynth.cancel(); State.speaking = false; document.getElementById('voice-btn').textContent = '🔊 Listen'; return; }
  const utt = new SpeechSynthesisUtterance(summary);
  utt.rate = 0.95; utt.pitch = 1.0;
  utt.onend = () => { State.speaking = false; document.getElementById('voice-btn').textContent = '🔊 Listen'; };
  State.speechSynth.speak(utt);
  State.speaking = true;
  document.getElementById('voice-btn').textContent = '⏹ Stop';
}

// ── QUIZ GENERATION ───────────────────────────────────────────
function setDifficulty(btn) {
  document.querySelectorAll('#difficulty-group .btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  State.difficulty = btn.dataset.val;
}

async function generateQuiz() {
  const n = parseInt(document.getElementById('num-questions').value) || 5;
  showLoading(`Generating ${n} ${State.difficulty} questions...`);

  const diffInstructions = {
    basic: 'Focus on definitions, facts, and basic recall. Use multiple-choice questions.',
    intermediate: 'Focus on understanding and application. Mix MCQ and short-answer questions.',
    advanced: 'Focus on analysis, synthesis, and critical thinking. Use primarily open-ended questions.',
  };

  const weakTopics = Object.entries(State.performance.topicScores)
    .filter(([, s]) => s < 60).map(([t]) => t);
  const focusNote = weakTopics.length > 0
    ? `Prioritize these weak topics: ${weakTopics.join(', ')}.` : '';

  const prompt = `You are a quiz generator. Create exactly ${n} questions from the study material below.
Difficulty: ${State.difficulty}. ${diffInstructions[State.difficulty]}
${focusNote}

Return ONLY valid JSON array in this format:
[
  {
    "id": 1,
    "topic": "topic name",
    "type": "mcq",
    "question": "...",
    "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
    "answer": "A) ..."
  },
  {
    "id": 2,
    "topic": "topic name",
    "type": "short",
    "question": "...",
    "answer": "expected answer"
  }
]

STUDY MATERIAL:
${State.docText.substring(0, 5000)}`;

  try {
    const raw = await callAI(prompt, 2048);
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('Invalid quiz response');

    State.quizQuestions = JSON.parse(jsonMatch[0]);
    renderQuiz();
    hideLoading();
    showToast(`✅ ${State.quizQuestions.length} questions ready!`);
  } catch (err) {
    hideLoading();
    showToast('❌ Quiz generation error: ' + err.message);
  }
}

function renderQuiz() {
  const container = document.getElementById('quiz-questions');
  container.innerHTML = State.quizQuestions.map((q, i) => {
    if (q.type === 'mcq') {
      const opts = (q.options || []).map((opt, oi) => `
        <label class="quiz-option" id="opt-${i}-${oi}">
          <input type="radio" name="q${i}" value="${escapeHtml(opt)}" onchange="selectOption(${i}, ${oi})"/>
          ${escapeHtml(opt)}
        </label>`).join('');
      return `<div class="quiz-q-card">
        <div class="q-number">Q${i + 1} · ${escapeHtml(q.topic || '')} · MCQ</div>
        <div class="q-text">${escapeHtml(q.question)}</div>
        <div class="quiz-options">${opts}</div>
      </div>`;
    } else {
      return `<div class="quiz-q-card">
        <div class="q-number">Q${i + 1} · ${escapeHtml(q.topic || '')} · Short Answer</div>
        <div class="q-text">${escapeHtml(q.question)}</div>
        <input type="text" class="quiz-short-input" id="short-${i}" placeholder="Type your answer..."/>
      </div>`;
    }
  }).join('');

  document.getElementById('quiz-container').classList.remove('hidden');
  document.getElementById('quiz-results').classList.add('hidden');
}

function selectOption(qIdx, optIdx) {
  const opts = document.querySelectorAll(`[id^="opt-${qIdx}-"]`);
  opts.forEach(o => o.classList.remove('selected'));
  document.getElementById(`opt-${qIdx}-${optIdx}`).classList.add('selected');
}

async function submitQuiz() {
  // Collect answers
  const userAnswers = State.quizQuestions.map((q, i) => {
    if (q.type === 'mcq') {
      const sel = document.querySelector(`input[name="q${i}"]:checked`);
      return sel ? sel.value : '';
    } else {
      return document.getElementById(`short-${i}`)?.value?.trim() || '';
    }
  });

  const allAnswered = userAnswers.every(a => a !== '');
  if (!allAnswered) { showToast('⚠️ Please answer all questions before submitting.'); return; }

  showLoading('Evaluating your answers with AI...');

  const evalPrompt = `You are a quiz evaluator. Evaluate these answers and return ONLY valid JSON.

Questions and Correct Answers:
${State.quizQuestions.map((q, i) => `Q${i+1} [${q.topic}]: ${q.question}\nCorrect: ${q.answer}\nUser answered: ${userAnswers[i]}`).join('\n\n')}

Return JSON array:
[{"id":1,"score":100,"status":"correct","feedback":"...","topic":"..."},...]
Status must be: "correct" (score 100), "partial" (score 50), or "incorrect" (score 0).
Feedback should explain why the answer is right/wrong/partial in 1-2 sentences.`;

  try {
    const raw = await callAI(evalPrompt, 2048);
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('Invalid evaluation response');

    const evaluation = JSON.parse(jsonMatch[0]);
    State.quizResults = evaluation;

    // Update performance
    const totalScore = evaluation.reduce((s, r) => s + (r.score || 0), 0) / evaluation.length;
    State.performance.attempts++;
    State.performance.history.push(Math.round(totalScore));
    if (State.performance.best === null || totalScore > State.performance.best) {
      State.performance.best = Math.round(totalScore);
    }

    // Update topic scores
    evaluation.forEach(r => {
      if (!r.topic) return;
      if (!State.performance.topicScores[r.topic]) State.performance.topicScores[r.topic] = [];
      if (!Array.isArray(State.performance.topicScores[r.topic])) {
        State.performance.topicScores[r.topic] = [State.performance.topicScores[r.topic]];
      }
      State.performance.topicScores[r.topic].push(r.score || 0);
    });

    renderResults(evaluation, Math.round(totalScore), userAnswers);
    updatePerformanceTab(Math.round(totalScore));
    hideLoading();
    showToast(`Quiz done! Score: ${Math.round(totalScore)}%`);
  } catch (err) {
    hideLoading();
    showToast('❌ Evaluation error: ' + err.message);
  }
}

function renderResults(evaluation, totalScore, userAnswers) {
  const grade = totalScore >= 80 ? '🌟 Excellent!' : totalScore >= 60 ? '👍 Good Job!' : totalScore >= 40 ? '📚 Keep Practicing' : '💡 Review Needed';
  const gradeColor = totalScore >= 80 ? '#4ade80' : totalScore >= 60 ? '#fbbf24' : '#f87171';

  const html = `
    <div class="score-banner">
      <div class="score-num">${totalScore}%</div>
      <div class="score-label">${evaluation.length} questions evaluated</div>
      <span class="score-badge" style="background:${gradeColor}22;color:${gradeColor};border:1px solid ${gradeColor}44">${grade}</span>
    </div>
    ${evaluation.map((r, i) => {
      const q = State.quizQuestions[i];
      return `<div class="result-card ${r.status || 'incorrect'}">
        <div class="result-q">Q${i+1}: ${escapeHtml(q?.question || '')}</div>
        <div class="result-answer">Your answer: <strong>${escapeHtml(userAnswers[i] || '(no answer)')}</strong></div>
        <div class="result-answer">Correct answer: <strong>${escapeHtml(q?.answer || '')}</strong></div>
        <div class="result-feedback">${escapeHtml(r.feedback || '')}</div>
      </div>`;
    }).join('')}
    <div style="text-align:center;margin-top:1rem;">
      <button class="btn btn-primary btn-lg" onclick="generateQuiz()">🔄 Try Another Quiz</button>
      <button class="btn btn-outline btn-lg" style="margin-left:0.5rem" onclick="switchTab('performance')">📊 View Performance</button>
    </div>`;

  document.getElementById('quiz-container').classList.add('hidden');
  const resultsEl = document.getElementById('quiz-results');
  resultsEl.innerHTML = html;
  resultsEl.classList.remove('hidden');
}

// ── PERFORMANCE TAB ───────────────────────────────────────────
function updatePerformanceTab(lastScore) {
  document.getElementById('stat-score').textContent = lastScore + '%';
  document.getElementById('stat-attempts').textContent = State.performance.attempts;
  document.getElementById('stat-best').textContent = State.performance.best + '%';

  drawChart();
  renderWeakTopics();
}

function drawChart() {
  const canvas = document.getElementById('perf-chart');
  const ctx = canvas.getContext('2d');
  const history = State.performance.history;
  if (history.length === 0) return;

  const W = canvas.offsetWidth || 400;
  const H = 160;
  canvas.width = W; canvas.height = H;
  ctx.clearRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = 'rgba(74,222,128,0.08)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = (H - 30) * (1 - i / 4) + 10;
    ctx.beginPath(); ctx.moveTo(30, y); ctx.lineTo(W - 10, y); ctx.stroke();
    ctx.fillStyle = '#4a7a58'; ctx.font = '10px Inter'; ctx.textAlign = 'right';
    ctx.fillText(i * 25 + '%', 28, y + 4);
  }

  if (history.length < 2) {
    ctx.fillStyle = '#4ade80'; ctx.beginPath();
    ctx.arc(W / 2, H / 2, 5, 0, Math.PI * 2); ctx.fill();
    return;
  }

  // Line
  const stepX = (W - 40) / (history.length - 1);
  const pts = history.map((v, i) => ({ x: 30 + i * stepX, y: 10 + (H - 40) * (1 - v / 100) }));

  // Gradient fill
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(74,222,128,0.25)'); grad.addColorStop(1, 'rgba(74,222,128,0)');
  ctx.beginPath(); ctx.moveTo(pts[0].x, H - 20);
  pts.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(pts[pts.length - 1].x, H - 20); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  // Main line
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
  pts.forEach((p, i) => { if (i > 0) ctx.lineTo(p.x, p.y); });
  ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2.5; ctx.stroke();

  // Dots
  pts.forEach((p, i) => {
    ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#4ade80'; ctx.fill();
    ctx.fillStyle = '#e2ffe8'; ctx.font = 'bold 9px Inter'; ctx.textAlign = 'center';
    ctx.fillText(history[i] + '%', p.x, p.y - 8);
  });
}

function renderWeakTopics() {
  const container = document.getElementById('weak-topics-list');
  const topics = Object.entries(State.performance.topicScores).map(([topic, scores]) => {
    const arr = Array.isArray(scores) ? scores : [scores];
    const avg = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
    return { topic, avg };
  }).sort((a, b) => a.avg - b.avg);

  if (topics.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:0.875rem;">Complete a quiz to see weak topics.</p>';
    return;
  }

  container.innerHTML = topics.map(({ topic, avg }) => `
    <div class="weak-item">
      <span class="topic-name">${escapeHtml(topic)}</span>
      <div class="weak-bar"><div class="weak-bar-fill" style="width:${avg}%"></div></div>
      <span class="topic-score">${avg}%</span>
    </div>`).join('');

  // Show adaptive btn if weak topics exist
  const hasWeak = topics.some(t => t.avg < 60);
  const btn = document.getElementById('adaptive-btn');
  if (btn) btn.style.display = hasWeak ? 'inline-flex' : 'none';

  // Update topic chips with weak styling
  document.querySelectorAll('.topic-chip').forEach(chip => {
    const topic = topics.find(t => t.topic === chip.textContent.trim());
    if (topic && topic.avg < 60) chip.classList.add('weak');
    else chip.classList.remove('weak');
  });
}

async function generateAdaptiveQuiz() {
  const weakTopics = Object.entries(State.performance.topicScores)
    .filter(([, scores]) => {
      const arr = Array.isArray(scores) ? scores : [scores];
      return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) < 60;
    }).map(([t]) => t);

  if (weakTopics.length === 0) { showToast('No weak topics found! Great job.'); return; }

  switchTab('quiz');
  // Auto-set difficulty one level up
  const levels = ['basic', 'intermediate', 'advanced'];
  const cur = levels.indexOf(State.difficulty);
  if (cur < 2) {
    State.difficulty = levels[cur + 1];
    document.querySelectorAll('#difficulty-group .btn').forEach(b => {
      b.classList.toggle('active', b.dataset.val === State.difficulty);
    });
  }
  showToast(`🎯 Generating adaptive quiz focused on: ${weakTopics.join(', ')}`);
  await generateQuiz();
}

// ── STUDY PLAN ────────────────────────────────────────────────
async function generateStudyPlan() {
  showLoading('Creating your personalized study plan...');
  const weakTopics = Object.entries(State.performance.topicScores)
    .filter(([, s]) => { const a = Array.isArray(s) ? s : [s]; return Math.round(a.reduce((x,y)=>x+y,0)/a.length) < 60; })
    .map(([t]) => t);

  const prompt = `Create a personalized 7-day study plan for a student studying: ${State.topics.join(', ')}.
${weakTopics.length > 0 ? `Weak areas needing extra focus: ${weakTopics.join(', ')}.` : ''}
Format as a clear day-by-day plan. For each day, specify:
- Day number and theme
- Topics to cover
- Suggested activities (reading, practice, quiz)
- Estimated time
Make it realistic and encouraging.`;

  try {
    const raw = await callAI(prompt, 1500);
    document.getElementById('study-plan-content').innerHTML = formatMarkdown(raw);
    hideLoading();
  } catch (err) {
    hideLoading();
    showToast('❌ Error: ' + err.message);
  }
}

// ── PRACTICE & REINFORCEMENT ──────────────────────────────────
async function generatePractice() {
  const topic = document.getElementById('practice-topic').value;
  if (!topic) { showToast('Please select a topic'); return; }
  showLoading(`Generating practice questions for "${topic}"...`);

  const prompt = `Generate 5 varied practice questions (mix of different types) specifically about "${topic}" based on this study material. Include hints and model answers.

Format clearly with Q1, Q2... and provide a Hint and Answer for each.

STUDY MATERIAL:
${State.docText.substring(0, 4000)}`;

  try {
    const raw = await callAI(prompt, 1200);
    document.getElementById('practice-content').innerHTML = formatMarkdown(raw);
    hideLoading();
  } catch (err) {
    hideLoading();
    showToast('❌ Error: ' + err.message);
  }
}

function quickPractice(topic) {
  switchTab('practice');
  const sel = document.getElementById('practice-topic');
  for (let i = 0; i < sel.options.length; i++) {
    if (sel.options[i].value === topic) { sel.selectedIndex = i; break; }
  }
  generatePractice();
}

// ── CHATBOT ───────────────────────────────────────────────────
function appendChat(msg, role) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.innerHTML = role === 'bot' ? formatMarkdown(msg) : escapeHtml(msg);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const question = input.value.trim();
  if (!question) return;
  if (!State.docText) { showToast('Please load a document first'); return; }

  input.value = '';
  appendChat(question, 'user');
  State.chatHistory.push({ role: 'user', content: question });

  const typing = appendChat('Thinking...', 'bot typing');

  const historyContext = State.chatHistory.slice(-6).map(h => `${h.role === 'user' ? 'Student' : 'Tutor'}: ${h.content}`).join('\n');

  const prompt = `You are a virtual tutor for a student studying the following document. Answer ONLY based on information found in the document. If the answer is not in the document, say so politely.

DOCUMENT CONTENT:
${State.docText.substring(0, 5000)}

CONVERSATION HISTORY:
${historyContext}

Student's question: ${question}

Provide a clear, helpful answer based strictly on the document content:`;

  try {
    const answer = await callAI(prompt, 800);
    typing.remove();
    appendChat(answer, 'bot');
    State.chatHistory.push({ role: 'bot', content: answer });
  } catch (err) {
    typing.remove();
    appendChat('Sorry, I encountered an error: ' + err.message, 'bot');
  }
}
