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
  provider: 'groq',
  documents: [], // new multi-doc array
  docText: '',
  topics: [],
  difficulty: 'basic',
  quizQuestions: [],
  quizResults: [],
  performance: { attempts: 0, best: null, history: [], topicScores: {}, bloomScores: {} },
  srsData: {},      // topic -> { interval, easeFactor, repetitions, dueDate }
  flashcards: [],
  fcIndex: 0,
  fcFlipped: false,
  fcSession: { got: 0, review: 0 },
  chatHistory: [],
  speechSynth: window.speechSynthesis || null,
  speaking: false,
};

// ── BLOOM CONFIG ─────────────────────────────────────────────
const BLOOM = {
  remember:   { label: 'Remember',   color: '#60a5fa', cls: 'bloom-remember'   },
  understand: { label: 'Understand', color: '#a78bfa', cls: 'bloom-understand' },
  apply:      { label: 'Apply',      color: 'var(--primary)', cls: 'bloom-apply'      },
  analyze:    { label: 'Analyze',    color: '#fbbf24', cls: 'bloom-analyze'    },
  evaluate:   { label: 'Evaluate',   color: '#fb923c', cls: 'bloom-evaluate'   },
  create:     { label: 'Create',     color: '#f87171', cls: 'bloom-create'     },
};
function bloomBadge(level) {
  const b = BLOOM[level?.toLowerCase()] || BLOOM.remember;
  return `<span class="bloom-badge ${b.cls}">${b.label}</span>`;
}



// ── NOTION PANELS ─────────────────────────────────────────────
let isLeftLocked = true;
let isRightLocked = true;

function toggleLeftLock() {
  isLeftLocked = !isLeftLocked;
  const sidebar = document.getElementById('sidebar-nav');
  const trigger = document.getElementById('left-trigger');
  const btn = document.getElementById('left-lock-btn');
  
  if (isLeftLocked) {
    sidebar.className = 'sidebar-nav locked';
    trigger.classList.add('hidden');
    btn.textContent = '◀';
  } else {
    sidebar.className = 'sidebar-nav collapsed';
    trigger.classList.remove('hidden');
    btn.textContent = '▶';
  }
}

function showLeftOverlay() {
  if (!isLeftLocked) {
    document.getElementById('sidebar-nav').className = 'sidebar-nav overlay';
  }
}

function hideLeftOverlay() {
  if (!isLeftLocked) {
    document.getElementById('sidebar-nav').className = 'sidebar-nav collapsed';
  }
}

function toggleRightLock() {
  isRightLocked = !isRightLocked;
  const panel = document.getElementById('app-main');
  const trigger = document.getElementById('right-trigger');
  const btn = document.getElementById('right-lock-btn');
  
  if (isRightLocked) {
    panel.className = 'right-pane app-container locked';
    trigger.classList.add('hidden');
    btn.textContent = '▶';
  } else {
    panel.className = 'right-pane app-container collapsed';
    trigger.classList.remove('hidden');
    btn.textContent = '◀';
  }
}

function showRightOverlay() {
  if (!isRightLocked) {
    document.getElementById('app-main').className = 'right-pane app-container overlay';
  }
}

function hideRightOverlay() {
  if (!isRightLocked) {
    document.getElementById('app-main').className = 'right-pane app-container collapsed';
  }
}

// ── THEME TOGGLE ─────────────────────────────────────────────

function toggleTheme() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const newTheme = isLight ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('sm_theme', newTheme);
  document.getElementById('theme-toggle').textContent = isLight ? '☀️' : '🌙';
  drawChart(); // Redraw chart with new colors
}

// ── INIT ─────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('sm_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  document.getElementById('theme-toggle').textContent = savedTheme === 'light' ? '🌙' : '☀️';

  const savedProvider = localStorage.getItem('sm_provider') || 'groq';
  setProvider(savedProvider);
  const saved = localStorage.getItem('sm_api_key');
  if (saved) {
    State.apiKey = saved;
    document.getElementById('api-key-input').value = saved;
    showKeyStatus('✅ API key loaded from storage', 'success');
  }
  loadState();
// ── ADVANCED INIT ──────────────────────────────────────────────
if (typeof mermaid !== 'undefined') {
  mermaid.initialize({ startOnLoad: false, theme: document.documentElement.getAttribute('data-theme') === 'light' ? 'default' : 'dark' });
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

// ── UNIFIED AI CALL ───────────────────────────────────────────
async function callAI(prompt, maxTokens = 2048) {
  if (!State.apiKey) { showToast('⚠️ Please save your API key first!'); throw new Error('No API key'); }
  return State.provider === 'groq'
    ? await callGroq(prompt, maxTokens)
    : await callGemini(prompt, maxTokens);
}

async function callGroq(prompt, maxTokens = 2048) {
  const url = 'https://api.groq.com/openai/v1/chat/completions';
  const body = {
    model: 'llama-3.1-8b-instant',
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

function switchDocumentView() {
  const switchId = document.getElementById('doc-switcher').value;
  const doc = State.documents.find(d => d.id === switchId);
  const iframe = document.getElementById('pdf-viewer');
  const docxContainer = document.getElementById('docx-viewer-container');
  
  iframe.style.display = 'none';
  docxContainer.style.display = 'none';
  iframe.src = '';
  
  if (!doc) return;
  
  if (doc.type === 'pdf' || doc.type === 'youtube') {
    iframe.src = doc.blobUrl || doc.embedUrl;
    iframe.style.display = 'block';
  } else if (doc.type === 'docx') {
    docxContainer.innerHTML = doc.htmlView || '';
    docxContainer.style.display = 'block';
  }
}

function updateDocUI() {
  const list = document.getElementById('doc-upload-list');
  list.innerHTML = State.documents.map(d => `
    <li class="doc-list-item">
      <span>📄 ${escapeHtml(d.name)}</span>
      <span class="doc-list-badge">${d.type.toUpperCase()}</span>
    </li>
  `).join('');
  
  const switcher = document.getElementById('doc-switcher');
  switcher.innerHTML = State.documents.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
  if(State.documents.length) switchDocumentView();
}

async function processFile(file) {
  const info = document.getElementById('file-info');
  info.textContent = `Adding ${file.name}...`;
  info.classList.remove('hidden');
  
  const docId = 'doc_' + Date.now() + '_' + Math.floor(Math.random()*1000);

  if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
    showLoading('Extracting text from PDF...');
    try {
      const blobUrl = URL.createObjectURL(file);
      const buffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
      let text = `[--- DOCUMENT: ${file.name} ---]
`;
      for (let i = 1; i <= Math.min(pdf.numPages, 40); i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += `[PAGE ${i}] ` + content.items.map(item => item.str).join(' ') + '\\n';
      }
      State.documents.push({ id: docId, name: file.name, type: 'pdf', rawText: text, blobUrl });
      hideLoading();
      showToast(`✅ Added PDF: ${file.name}`);
    } catch (err) {
      hideLoading();
      showToast('❌ Error reading PDF: ' + err.message);
    }
  } else if (file.name.endsWith('.docx')) {
    showLoading('Extracting content from Word Document...');
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target.result;
        const txtRes = await mammoth.extractRawText({ arrayBuffer });
        const htmlRes = await mammoth.convertToHtml({ arrayBuffer });
        
        let text = `[--- DOCUMENT: ${file.name} ---]
` + txtRes.value.trim();
        State.documents.push({ id: docId, name: file.name, type: 'docx', rawText: text, htmlView: htmlRes.value });
        hideLoading();
        showToast(`✅ Added Word Document`);
        updateDocUI();
      } catch(err) {
        hideLoading();
        showToast('❌ Error reading DOCX: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
    return; // reader is async
  } else if (file.name.endsWith('.txt')) {
    const reader = new FileReader();
    reader.onload = (e) => { 
      let text = `[--- DOCUMENT: ${file.name} ---]
` + e.target.result;
      State.documents.push({ id: docId, name: file.name, type: 'txt', rawText: text });
      updateDocUI();
      showToast('✅ Text file added');
    };
    reader.readAsText(file);
    return;
  } else {
    showToast('⚠️ Supported files: PDF, DOCX, TXT');
  }
  updateDocUI();
}

async function loadDocument() {
  let aggregateText = State.documents.map(d => d.rawText).join('\\n\\n');
  const manualText = document.getElementById('text-input').value.trim();
  if (manualText && !manualText.includes('[YouTube')) {
    aggregateText += '\\n\\n[--- MANUALLY PASTED TEXT ---]\\n' + manualText;
  }
  
  if (!aggregateText || aggregateText.length < 50) { showToast('⚠️ Please upload documents or add text first.'); return; }
  if (!State.apiKey) { showToast('⚠️ Please save your API key first!'); return; }

  State.docText = aggregateText;

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
${State.docText.substring(0, 6000)}`;

    const raw = await callAI(prompt, 1024);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Invalid response from AI');

    const parsed = JSON.parse(jsonMatch[0]);
    State.topics = parsed.topics || [];

    // Show results
    document.getElementById('summary-content').innerHTML = formatMarkdown(parsed.summary || 'No summary generated.');
    renderTopics();
    populatePracticeTopic();
    renderWeakTopics(); // Colorize them immediately using historical data

    document.getElementById('setup-container').classList.add('hidden');
    document.getElementById('workspace').classList.remove('hidden');
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
    basic:        'Focus on Remember and Understand levels (definitions, facts, recall).',
    intermediate: 'Focus on Apply and Analyze levels (application, comparison, problem solving).',
    advanced:     'Focus on Evaluate and Create levels (critique, design, synthesis).',
  };
  const bloomForDiff = {
    basic: ['remember','understand'],
    intermediate: ['apply','analyze'],
    advanced: ['evaluate','create'],
  };

  const weakTopics = Object.entries(State.performance.topicScores)
    .filter(([, s]) => { const a = Array.isArray(s)?s:[s]; return Math.round(a.reduce((x,y)=>x+y,0)/a.length) < 60; })
    .map(([t]) => t);
  const focusNote = weakTopics.length > 0 ? `Prioritize these weak topics: ${weakTopics.join(', ')}.` : '';

  const prompt = `You are an expert quiz generator aligned with Bloom's Taxonomy. Create exactly ${n} questions from the study material.
Difficulty: ${State.difficulty}. ${diffInstructions[State.difficulty]}
${focusNote}

Return ONLY a valid JSON array:
[
  {
    "id": 1,
    "topic": "topic name",
    "bloom_level": "remember",
    "type": "mcq",
    "question": "...",
    "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
    "answer": "A) ..."
  },
  {
    "id": 2,
    "topic": "topic name",
    "bloom_level": "apply",
    "type": "short",
    "question": "...",
    "answer": "expected answer"
  }
]
bloom_level must be one of: remember, understand, apply, analyze, evaluate, create.

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
    const badge = bloomBadge(q.bloom_level);
    if (q.type === 'mcq') {
      const opts = (q.options || []).map((opt, oi) => `
        <label class="quiz-option" id="opt-${i}-${oi}">
          <input type="radio" name="q${i}" value="${escapeHtml(opt)}" onchange="selectOption(${i}, ${oi})"/>
          ${escapeHtml(opt)}
        </label>`).join('');
      return `<div class="quiz-q-card">
        <div class="quiz-q-meta"><span class="q-number-label">Q${i+1} · ${escapeHtml(q.topic||'')} · MCQ</span>${badge}</div>
        <div class="q-text">${escapeHtml(q.question)}</div>
        <div class="quiz-options">${opts}</div>
      </div>`;
    } else {
      return `<div class="quiz-q-card">
        <div class="quiz-q-meta"><span class="q-number-label">Q${i+1} · ${escapeHtml(q.topic||'')} · Short Answer</span>${badge}</div>
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

    const totalScore = evaluation.reduce((s, r) => s + (r.score || 0), 0) / evaluation.length;
    State.performance.attempts++;
    State.performance.history.push(Math.round(totalScore));
    if (State.performance.best === null || totalScore > State.performance.best)
      State.performance.best = Math.round(totalScore);

    // Update topic scores
    evaluation.forEach(r => {
      if (!r.topic) return;
      if (!Array.isArray(State.performance.topicScores[r.topic]))
        State.performance.topicScores[r.topic] = [];
      State.performance.topicScores[r.topic].push(r.score || 0);
    });

    // Update bloom scores
    State.quizQuestions.forEach((q, i) => {
      const level = (q.bloom_level || 'remember').toLowerCase();
      const score = evaluation[i]?.score || 0;
      if (!Array.isArray(State.performance.bloomScores[level]))
        State.performance.bloomScores[level] = [];
      State.performance.bloomScores[level].push(score);
    });

    // Update SRS for each topic based on score
    evaluation.forEach(r => {
      if (!r.topic) return;
      const quality = r.score >= 80 ? 5 : r.score >= 50 ? 3 : 1;
      updateSRS(r.topic, quality);
    });

    renderResults(evaluation, Math.round(totalScore), userAnswers);
    updatePerformanceTab(Math.round(totalScore));
    saveState();
    hideLoading();
    showToast(`Quiz done! Score: ${Math.round(totalScore)}%`);
  } catch (err) {
    hideLoading();
    showToast('❌ Evaluation error: ' + err.message);
  }
}

function renderResults(evaluation, totalScore, userAnswers) {
  const grade = totalScore >= 80 ? '🌟 Excellent!' : totalScore >= 60 ? '👍 Good Job!' : totalScore >= 40 ? '📚 Keep Practicing' : '💡 Review Needed';
  const gradeColor = totalScore >= 80 ? 'var(--primary)' : totalScore >= 60 ? '#fbbf24' : '#f87171';

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
  document.getElementById('stat-best').textContent = (State.performance.best ?? '—') + '%';
  drawChart();
  renderWeakTopics();
  renderBloomBreakdown();
  renderSRSDue();
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
  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue("--border").trim();
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = (H - 30) * (1 - i / 4) + 10;
    ctx.beginPath(); ctx.moveTo(30, y); ctx.lineTo(W - 10, y); ctx.stroke();
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text-dim').trim(); ctx.font = '10px Inter'; ctx.textAlign = 'right';
    ctx.fillText(i * 25 + '%', 28, y + 4);
  }

  if (history.length < 2) {
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--primary').trim(); ctx.beginPath();
    ctx.arc(W / 2, H / 2, 5, 0, Math.PI * 2); ctx.fill();
    return;
  }

  // Line
  const stepX = (W - 40) / (history.length - 1);
  const pts = history.map((v, i) => ({ x: 30 + i * stepX, y: 10 + (H - 40) * (1 - v / 100) }));

  // Gradient fill
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, getComputedStyle(document.body).getPropertyValue('--primary-glow2').trim()); grad.addColorStop(1, 'transparent');
  ctx.beginPath(); ctx.moveTo(pts[0].x, H - 20);
  pts.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(pts[pts.length - 1].x, H - 20); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  // Main line
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
  pts.forEach((p, i) => { if (i > 0) ctx.lineTo(p.x, p.y); });
  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--primary').trim(); ctx.lineWidth = 2.5; ctx.stroke();

  // Dots
  pts.forEach((p, i) => {
    ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--primary').trim(); ctx.fill();
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg').trim(); ctx.font = 'bold 9px Inter'; ctx.textAlign = 'center';
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

  // Update ALL topic chips globally (in Summary tab, etc.)
  document.querySelectorAll('.topic-chip').forEach(chip => {
    const topicData = topics.find(t => t.topic === chip.textContent.trim());
    chip.classList.remove('good', 'medium', 'weak');
    if (topicData) {
      if (topicData.avg >= 80) chip.classList.add('good');
      else if (topicData.avg >= 60) chip.classList.add('medium');
      else chip.classList.add('weak');
    }
  });

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
  if (!State.docText) return showToast('Please analyze a document first!', true);
  
  const timeline = document.getElementById('sp-timeline').value;
  const focus = document.getElementById('sp-focus').value;
  const instructions = document.getElementById('sp-instructions').value;

  document.getElementById('study-plan-output').classList.add('hidden');
  document.getElementById('loading-overlay').classList.remove('hidden');
  document.getElementById('loading-text').textContent = 'Building your personalized timeline...';

  try {
    const prompt = `You are an expert AI tutor. Create a highly structured study plan based on the document text.
User Constraints:
- Timeline: ${timeline}
- Focus Area: ${focus}
${instructions ? '- Custom Request: ' + instructions : ''}

You MUST return the output EXACTLY in this JSON format (an array of day objects):
[
  {
    "day": 1,
    "title": "Introduction to Core Concepts",
    "tasks": ["Read pages 1-5", "Summarize the primary definition", "Review flashcards"]
  }
]
Do not return any markdown outside the JSON array. Output valid JSON only.

Document Text limit:
${State.docText.substring(0, 5000)}`;

    const res = await callAI(prompt);
    
    // Attempt to parse json
    let jsonMatch = res.match(/\[.*\]/s);
    let planData = [];
    if (jsonMatch) {
       planData = JSON.parse(jsonMatch[0]);
    } else {
       planData = JSON.parse(res);
    }
    
    renderStudyTimeline(planData);
  } catch(e) {
    showToast('Failed to generate study plan: ' + e.message, true);
    console.error(e);
  } finally {
    document.getElementById('loading-overlay').classList.add('hidden');
  }
}

function renderStudyTimeline(planData) {
  const container = document.getElementById('study-plan-output');
  container.innerHTML = '<div class="timeline"></div>';
  const timelineEl = container.querySelector('.timeline');
  
  planData.forEach(dayObject => {
    let tasksHtml = '';
    dayObject.tasks.forEach((task, idx) => {
       const uId = `task-${dayObject.day}-${idx}`;
       tasksHtml += `
         <label class="timeline-task" for="${uId}">
           <input type="checkbox" id="${uId}" class="timeline-cb" onclick="this.parentElement.classList.toggle('completed', this.checked)">
           <div class="timeline-task-content">${task}</div>
         </label>
       `;
    });

    timelineEl.innerHTML += `
      <div class="timeline-day">
        <div class="timeline-dot"></div>
        <div class="timeline-day-header">Day ${dayObject.day}</div>
        <div class="timeline-day-title">${dayObject.title}</div>
        <div class="timeline-tasks">
          ${tasksHtml}
        </div>
      </div>
    `;
  });
  
  container.classList.remove('hidden');
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
  setTimeout(() => {
    container.scrollTop = container.scrollHeight;
  }, 10);
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

  const isSocratic = document.getElementById('socratic-toggle').checked;
  const sysPrompt = isSocratic
    ? `You are a Socratic tutor. Guide the student by asking probing questions and giving hints based on the document. DO NOT give direct answers immediately. Encourage them to think.`
    : `You are a virtual tutor. Answer ONLY based on information found in the document. If the answer is not in the document, say so politely.`;

  const prompt = `${sysPrompt}
IMPORTANT: Whenever you draw information from a specific page, you MUST end your entire response with a reference marker like so: [PAGE: 4]. Use the [--- PAGE X ---] markers in the document to know which page you are on.

DOCUMENT CONTENT:
${State.docText.substring(0, 10000)}

CONVERSATION HISTORY:
${historyContext}

Student's question: ${question}

Provide a clear, helpful response based strictly on the document text:`;

  try {
    const rawAnswer = await callAI(prompt, 800);
    typing.remove();
    let displayAnswer = rawAnswer;
    
    // Parse page marker [PAGE: X]
    const pageMatch = rawAnswer.match(/\[PAGE:\s*(\d+)\]/i);
    if (pageMatch && State.fileBlobUrl) {
      const pageNum = pageMatch[1];
      scrollToPage(pageNum);
      displayAnswer = rawAnswer.replace(/\[PAGE:\s*\d+\]/ig, '').trim();
      displayAnswer += `\n\n<button class="btn btn-outline btn-sm" style="margin-top:0.6rem" onclick="scrollToPage(${pageNum})">📄 View Source (Page ${pageNum})</button>`;
    }

    appendChat(displayAnswer, 'bot');
    State.chatHistory.push({ role: 'bot', content: displayAnswer });
  } catch (err) {
    typing.remove();
    appendChat('Sorry, I encountered an error: ' + err.message, 'bot');
  }
}

function scrollToPage(pageNum) {
  if (!State.fileBlobUrl) return;
  const oldIframe = document.getElementById('pdf-viewer');
  const container = document.getElementById('pdf-pane');
  if (oldIframe && container) {
    // Replacing the iframe completely forces the native PDF engine to jump to the new hash on Blob URLs
    const newIframe = oldIframe.cloneNode(true);
    newIframe.src = State.fileBlobUrl + '#page=' + pageNum + '&navpanes=0&toolbar=0&view=FitH';
    container.replaceChild(newIframe, oldIframe);
    showToast(`📄 Jumped to page ${pageNum}`);
  }
}

function toggleSocraticMode() {
  const isSocratic = document.getElementById('socratic-toggle').checked;
  const label = document.getElementById('socratic-label');
  if (isSocratic) {
    label.style.color = 'var(--green)';
    showToast('🧠 Socratic Mode ON: I will guide you with questions.');
  } else {
    label.style.color = 'var(--text-muted)';
    showToast('💬 Socratic Mode OFF: Direct answers restored.');
  }
}

// ══════════════════════════════════════════════════════════════
// FEATURE 1 — PROGRESS PERSISTENCE
// ══════════════════════════════════════════════════════════════
function saveState() {
  try {
    localStorage.setItem('sm_performance', JSON.stringify(State.performance));
    localStorage.setItem('sm_srs', JSON.stringify(State.srsData));
  } catch (e) { console.warn('Could not save state:', e); }
}

function loadState() {
  try {
    const perf = localStorage.getItem('sm_performance');
    if (perf) {
      const p = JSON.parse(perf);
      State.performance = { attempts:0, best:null, history:[], topicScores:{}, bloomScores:{}, ...p };
    }
    const srs = localStorage.getItem('sm_srs');
    if (srs) State.srsData = JSON.parse(srs);

    // Refresh performance tab if there's data
    if (State.performance.attempts > 0) {
      const last = State.performance.history.slice(-1)[0] ?? 0;
      updatePerformanceTab(last);
    }
  } catch (e) { console.warn('Could not load state:', e); }
}

function resetProgress() {
  if (!confirm('Reset all quiz history, scores, and SRS data? This cannot be undone.')) return;
  State.performance = { attempts: 0, best: null, history: [], topicScores: {}, bloomScores: {} };
  State.srsData = {};
  localStorage.removeItem('sm_performance');
  localStorage.removeItem('sm_srs');
  document.getElementById('stat-score').textContent = '—';
  document.getElementById('stat-attempts').textContent = '0';
  document.getElementById('stat-best').textContent = '—';
  document.getElementById('weak-topics-list').innerHTML = '<p style="color:var(--text-muted);font-size:0.875rem;">Complete a quiz to see weak topics.</p>';
  document.getElementById('srs-due-section').classList.add('hidden');
  const bc = document.getElementById('bloom-breakdown-container');
  if (bc) bc.innerHTML = '';
  renderTopics();
  showToast('🗑️ Progress reset successfully.');
}

// ══════════════════════════════════════════════════════════════
// FEATURE 2 — SM-2 SPACED REPETITION
// ══════════════════════════════════════════════════════════════
function sm2(quality, repetitions, easeFactor, interval) {
  // SM-2 Algorithm (Wozniak, 1987) — quality: 0 (blackout) to 5 (perfect)
  if (quality >= 3) {
    if (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = 6;
    else interval = Math.round(interval * easeFactor);
    repetitions++;
  } else {
    repetitions = 0;
    interval = 1;
  }
  easeFactor = Math.max(1.3, easeFactor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + interval);
  return { repetitions, easeFactor, interval, dueDate: dueDate.toISOString() };
}

function updateSRS(topic, quality) {
  const existing = State.srsData[topic] || { repetitions: 0, easeFactor: 2.5, interval: 1, dueDate: null };
  State.srsData[topic] = sm2(quality, existing.repetitions, existing.easeFactor, existing.interval);
}

function renderSRSDue() {
  const today = new Date(); today.setHours(0,0,0,0);
  const due = Object.entries(State.srsData).filter(([, d]) => {
    if (!d.dueDate) return false;
    const dd = new Date(d.dueDate); dd.setHours(0,0,0,0);
    return dd <= today;
  });

  const section = document.getElementById('srs-due-section');
  const list = document.getElementById('srs-due-list');
  if (due.length === 0) { section.classList.add('hidden'); return; }

  section.classList.remove('hidden');
  list.innerHTML = due.map(([topic, d]) => `
    <div class="weak-item" style="cursor:pointer" onclick="quickPractice('${escapeHtml(topic)}')">
      <span class="topic-name">${escapeHtml(topic)}</span>
      <span class="srs-badge">📅 Review Due</span>
    </div>`).join('');
}

// ══════════════════════════════════════════════════════════════
// FEATURE 3 — BLOOM'S TAXONOMY PERFORMANCE BREAKDOWN
// ══════════════════════════════════════════════════════════════
function renderBloomBreakdown() {
  // Inject bloom breakdown section if not present
  let container = document.getElementById('bloom-breakdown-container');
  if (!container) {
    const perfCard = document.querySelector('#tab-performance .card');
    if (!perfCard) return;
    container = document.createElement('div');
    container.id = 'bloom-breakdown-container';
    perfCard.appendChild(container);
  }

  const bloomEntries = Object.entries(BLOOM);
  const hasData = bloomEntries.some(([k]) => State.performance.bloomScores[k]?.length > 0);
  if (!hasData) { container.innerHTML = ''; return; }

  const rows = bloomEntries.map(([key, cfg]) => {
    const scores = State.performance.bloomScores[key] || [];
    const avg = scores.length
      ? Math.round(scores.reduce((a,b) => a+b, 0) / scores.length)
      : null;
    if (avg === null) return '';
    return `<div class="bloom-row">
      <span class="bloom-label"><span class="bloom-badge ${cfg.cls}" style="font-size:0.65rem">${cfg.label}</span></span>
      <div class="bloom-bar-wrap"><div class="bloom-bar-fill" style="width:${avg}%;background:${cfg.color}"></div></div>
      <span class="bloom-pct">${avg}%</span>
    </div>`;
  }).join('');

  container.innerHTML = `
    <div style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border)">
      <h4 style="font-size:0.85rem;color:var(--text-muted);margin-bottom:0.6rem">🧠 Bloom's Taxonomy Breakdown</h4>
      <div class="bloom-breakdown">${rows}</div>
    </div>
    <button class="btn btn-outline btn-sm" style="margin-top:1rem" onclick="resetProgress()">🗑️ Reset Progress</button>`;
}

// ══════════════════════════════════════════════════════════════
// FEATURE 4 — FLASHCARD MODE (Anki-Style with SM-2)
// ══════════════════════════════════════════════════════════════
async function generateFlashcards() {
  if (!State.docText) { showToast('Please load a document first.'); return; }
  showLoading('Generating AI flashcards...');

  const prompt = `You are a flashcard generator using Bloom's Taxonomy. Create 15 flashcards from the study material below.

Return ONLY a valid JSON array:
[
  {
    "id": 1,
    "question": "What is ...?",
    "answer": "...",
    "bloom_level": "remember",
    "topic": "topic name"
  }
]
bloom_level must be one of: remember, understand, apply, analyze, evaluate, create.
Mix all 6 levels. Keep answers concise (1-3 sentences).

STUDY MATERIAL:
${State.docText.substring(0, 5000)}`;

  try {
    const raw = await callAI(prompt, 2000);
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('Invalid flashcard response');
    State.flashcards = JSON.parse(jsonMatch[0]);
    State.fcIndex = 0;
    State.fcFlipped = false;
    State.fcSession = { got: 0, review: 0 };
    renderFlashcards();
    hideLoading();
    showToast(`✅ ${State.flashcards.length} flashcards ready!`);
  } catch (err) {
    hideLoading();
    showToast('❌ Error: ' + err.message);
  }
}

function renderFlashcards() {
  const cards = State.flashcards;
  if (!cards.length) return;
  document.getElementById('fc-generate-hint').classList.add('hidden');
  document.getElementById('fc-container').classList.remove('hidden');
  document.getElementById('fc-session-stats').classList.add('hidden');
  document.getElementById('fc-counter').classList.remove('hidden');
  document.getElementById('fc-total').textContent = cards.length;
  showCard(State.fcIndex);
  updateDots();
}

function showCard(idx) {
  const card = State.flashcards[idx];
  if (!card) return;
  State.fcIndex = idx;
  State.fcFlipped = false;
  document.getElementById('fc-card').classList.remove('flipped');
  document.getElementById('fc-question').textContent = card.question;
  document.getElementById('fc-answer').textContent = card.answer;
  document.getElementById('fc-bloom-badge').className = `bloom-badge ${BLOOM[card.bloom_level?.toLowerCase()]?.cls || 'bloom-remember'}`;
  document.getElementById('fc-bloom-badge').textContent = BLOOM[card.bloom_level?.toLowerCase()]?.label || 'Remember';
  document.getElementById('fc-cur').textContent = idx + 1;
  updateDots();
}

function flipCard() {
  State.fcFlipped = !State.fcFlipped;
  document.getElementById('fc-card').classList.toggle('flipped', State.fcFlipped);
}

function nextCard() {
  if (State.fcIndex < State.flashcards.length - 1) showCard(State.fcIndex + 1);
}

function prevCard() {
  if (State.fcIndex > 0) showCard(State.fcIndex - 1);
}

function rateCard(quality) {
  // quality: 1=hard, 3=ok, 5=easy (maps to SM-2)
  const card = State.flashcards[State.fcIndex];
  if (!card) return;

  // Update SM-2 for this topic
  updateSRS(card.topic || card.question.substring(0,30), quality);
  saveState();

  // Track session stats
  if (quality >= 3) State.fcSession.got++;
  else State.fcSession.review++;
  document.getElementById('fc-got').textContent = State.fcSession.got;
  document.getElementById('fc-review').textContent = State.fcSession.review;

  // Mark dot as done
  const dots = document.querySelectorAll('.fc-dot');
  if (dots[State.fcIndex]) {
    dots[State.fcIndex].classList.add('done');
    dots[State.fcIndex].classList.remove('active');
  }

  // Move to next or show summary
  if (State.fcIndex < State.flashcards.length - 1) {
    showCard(State.fcIndex + 1);
    document.getElementById('fc-session-stats').classList.remove('hidden');
  } else {
    document.getElementById('fc-session-stats').classList.remove('hidden');
    showToast(`\uD83C\uDF89 Done! Got ${State.fcSession.got}, Review ${State.fcSession.review}`);
  }
}

function updateDots() {
  const container = document.getElementById('fc-progress-dots');
  const max = Math.min(State.flashcards.length, 15);
  container.innerHTML = Array.from({ length: max }, (_, i) =>
    `<div class="fc-dot${i === State.fcIndex ? ' active' : ''}" onclick="showCard(${i})"></div>`
  ).join('');
}




// ══════════════════════════════════════════════════════════════
// ADVANCED FEATURES (YouTube, MindMap, Cheat Sheet)
// ══════════════════════════════════════════════════════════════

// ── 1. YOUTUBE INGESTION ──
function extractYouTubeID(url) {
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))((\w|-){11})/);
  return match ? match[1] : null;
}

async function loadYouTube() {
  const url = document.getElementById('yt-input').value.trim();
  const rawVid = extractYouTubeID(url);
  if (!rawVid) return showToast('⚠️ Please enter a valid YouTube URL');
  if (!State.apiKey) return showToast('⚠️ Please save your API key first!');

  // Replace PDF viewer with YT Embed
  const docId = 'yt_' + Date.now();
  const embedUrl = `https://www.youtube-nocookie.com/embed/${rawVid}?rel=0`;
  State.documents.push({ id: docId, name: 'YouTube Lecture', type: 'youtube', embedUrl, rawText: `[--- YOUTUBE REFERENCE URL: ${url} ---]
` });
  updateDocUI();
  document.getElementById('doc-switcher').value = docId;
  switchDocumentView();
  showLoading('Fetching YouTube Transcript...');
  try {
    // There is no native CORS-free browser API for YT transcripts. We will try a public proxy or fallback.
    const proxy = `https://youtube-browser-api.onrender.com/transcript?videoId=${rawVid}`;
    
    // As a fail-safe for browser-only apps, we simulate extraction failure so they paste the transcript 
    // OR we can pass the URL raw to Gemini directly (Gemini 1.5 Flash natively supports grounding but our REST endpoint requires the video file).
    // We will attempt to ask the AI to summarize based on the URL. If the model has search grounding, it works!
    let fallbackText = `Here is a YouTube Video Link: ${url}. Please analyze this video.`;
    State.docText = fallbackText;
    
    document.getElementById('setup-container').classList.add('hidden');
    document.getElementById('workspace').classList.remove('hidden');
    switchTab('summary');
    hideLoading();
    
    showToast('⚠️ Video Embed active! To get perfect AI quizzes, please PASTE the transcript text into the app, as browsers block auto-downloading subtitles.', 8000);
    
    // We run loadDocument implicitly with the link text just to prep the UI
    document.getElementById('text-input').value = `[YouTube Video Mode Active]\nURL: ${url}\nNote: To get accurate quizzes, please manually copy-paste the video transcript here.`;
    
  } catch (err) {
    hideLoading();
    showToast('❌ Failed to process YouTube. ' + err.message);
  }
}

// ── 2. MIND MAP (Mermaid) ──
async function generateMindMap() {
  if (!State.docText) return showToast('Please load a document first');
  const container = document.getElementById('mermaid-container');
  
  showLoading('Drawing your Mind Map...');
  const prompt = `You are a data scientist constructing a Cross-Document Knowledge Graph. Read the provided study material (which may contain multiple distinct documents). 
Build a Mermaid.js diagram (graph TD) connecting the core overarching concepts together. 
CRITICALLY: Explicitly draw node connections spanning across topics to show how different documents interlock and relate to each other.
Only output the valid Mermaid code block, nothing else. Do not use quotes or special characters inside node names. Keep node names short (1-3 words).

Example format:
graph TD
  A[Machine Learning] --> B[Supervised]
  A --> C[Unsupervised]

MATERIAL:
${State.docText.substring(0, 4000)}`;

  try {
    const raw = await callAI(prompt, 1000);
    // Extract everything between ```mermaid and ``` or just assume it is the string
    let mermaidCode = raw.replace(/```(mermaid)?/g, '').trim();
    
    container.innerHTML = '<div class="mermaid" id="graphDiv"></div>';
    
    // Re-init theme based on toggle
    const theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'default' : 'dark';
    mermaid.initialize({ startOnLoad: false, theme });

    const { svg } = await mermaid.render('graphDiv', mermaidCode);
    container.innerHTML = svg;
    
    hideLoading();
    showToast('✨ Mind map generated!');
  } catch (err) {
    hideLoading();
    showToast('❌ Diagram generation failed: ' + err.message);
    console.error(err);
  }
}

// ── 3. CHEAT SHEET EXPORT (html2pdf) ──
function exportCheatSheet() {
  if (!State.extractedText && !State.docText) return showToast('Please load a document and generate a summary first!');
  
  showLoading('Compiling PDF Cheat Sheet...');
  
  // Build an invisible DOM element formatted perfectly for printing
  const element = document.createElement('div');
  element.id = 'print-template';
  
  const sumHtml = document.getElementById('summary-content').innerHTML;
  const weakTopics = Object.keys(State.performance.topicScores).slice(0,5).join(', ') || 'No weak topics yet (Take a quiz!)';
  
  // Grab top flashcards
  let fcHtml = '<ul>';
  State.flashcards.slice(0, 5).forEach(fc => {
    fcHtml += `<li style="margin-bottom:10px"><strong>Q:</strong> ${escapeHtml(fc.question)}<br/><strong>A:</strong> ${escapeHtml(fc.answer)}</li>`;
  });
  fcHtml += '</ul>';
  if(State.flashcards.length === 0) fcHtml = '<p>Generate Flashcards first!</p>';

  element.innerHTML = `
    <div style="font-family: Arial, sans-serif; color: #111;">
      <h1 style="color: #2563eb; border-bottom: 2px solid #2563eb; padding-bottom: 10px;">StudyMind Cheat Sheet</h1>
      
      <h2 style="color: #333; margin-top: 30px;">Overview Summary</h2>
      <div style="font-size: 14px; line-height: 1.6;">${sumHtml}</div>
      
      <h2 style="color: #333; margin-top: 30px;">Priority Review Topics</h2>
      <p style="font-size: 14px; color: #d97706; font-weight: bold;">${weakTopics}</p>
      
      <h2 style="color: #333; margin-top: 30px;">Core Flashcards</h2>
      <div style="font-size: 14px; line-height: 1.6;">${fcHtml}</div>
      
      <div style="margin-top: 50px; text-align: center; font-size: 12px; color: #888;">
        Generated by StudyMind AI
      </div>
    </div>
  `;
  document.body.appendChild(element);
  
  // Call html2pdf
  element.style.display = 'block'; // make visible for render
  const opt = {
    margin:       0.5,
    filename:     'StudyMind_CheatSheet.pdf',
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  { scale: 2 },
    jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }
  };
  
  html2pdf().set(opt).from(element).save().then(() => {
    document.body.removeChild(element);
    hideLoading();
    showToast('📥 Cheat Sheet Downloaded Successfully!');
  }).catch(e => {
    document.body.removeChild(element);
    hideLoading();
    showToast('❌ Export failed: ' + e.message);
  });
}
