// ==========================================================================
// App State & Data Management
// ==========================================================================

let materials = [];
let userHistory = [];

// Single Topic Quiz State
let currentQuiz = {
  material: null,
  questions: [],
  currentQuestionIndex: 0,
  answers: [],
};

// BSU Exam Simulator State
let currentExam = {
  ticketNumber: 0,
  questions: [],
  answers: ["", "", "", "", ""], // answers for the 5 questions
  evaluations: [], // detailed evaluation results for each question
  timerSeconds: 7200, // 120 minutes
  timerInterval: null,
  currentQuestionIndex: 0
};

// Azerbaijani Stop Words to filter out in text analysis
const azStopWords = new Set([
  "ve", "və", "ile", "ilə", "ucun", "üçün", "ise", "isə", "da", "də", "ki", "bu", "o", "olar", "olur",
  "olan", "olaraq", "tərəfindən", "terefinden", "bir", "biri", "her", "hər", "hansi", "hansı", "kimi",
  "kimidir", "uzrə", "üzrə", "sonra", "əvvəl", "evvel", "dair", "aid", "bəzi", "bezi", "çox", "cox"
]);

// Azerbaijani suffix list to normalize words (stemming approximation)
const azSuffixes = [
  "dır", "dir", "dur", "dür", "nın", "nin", "nun", "nün", "ya", "ye", "a", "ə", "da", "də",
  "dan", "dən", "lar", "lər", "ın", "in", "un", "ün", "ı", "i", "u", "ü", "yə", "ya", "nı", "ni", "nu", "nü"
];

// Initialize the Application
document.addEventListener("DOMContentLoaded", () => {
  loadData();
  setupEventListeners();
  setupPdfUpload();
  renderMaterials();
  renderBsuTickets();
  renderGuideSections();
  renderGuideQuestions();
  renderFormulasTable();
  updateGlobalStats();
  renderHistory();
});

// Normalise category to match UI filter tags
function getNormalizedCategory(rawCategory) {
  if (["Mexanika", "Dinamika və Hərəkət", "Akustika", "Dinamika", "Qravitasiya", "Hidrostatika"].includes(rawCategory)) {
    return "Mexanika";
  } else if (["Molekulyar Fizika", "MKN", "Qaz və Mayelər"].includes(rawCategory)) {
    return "Molekulyar Fizika";
  } else if (["Termodinamika", "İstilik və Buxarlar"].includes(rawCategory)) {
    return "Termodinamika";
  } else if (["Deformasiya və Süxurlar", "Seysmik Dalğalar"].includes(rawCategory)) {
    return "Seysmik Dalğalar";
  } else if (rawCategory === "Geofizika tətbiqi") {
    return "Geofizika tətbiqi";
  }
  return rawCategory;
}

// Load data from localStorage or fallback to defaults
function loadData() {
  const storedMaterials = localStorage.getItem("fizika_materials");
  let loaded = [];
  if (storedMaterials) {
    loaded = JSON.parse(storedMaterials);
  }

  // Map the 40 questions from bsuQuestions to Mövzu Kitabxanası materials
  const mappedQuestions = bsuQuestions.map(q => {
    return {
      id: `mat-bsu-sual-${q.number}`,
      title: q.title,
      category: getNormalizedCategory(q.category),
      description: q.content.replace(/\n/g, ' ').substring(0, 120) + "...",
      content: q.content,
      questions: [
        {
          id: `q-mat-${q.number}`,
          question: `${q.title} mövzusunu ətraflı şərh edin, əsas düsturları və geofiziki tətbiqləri izah edin.`,
          templateAnswer: q.content,
          keywords: q.keywords
        }
      ],
      isCustom: false
    };
  });

  // Keep user-uploaded custom materials
  const customMaterials = loaded.filter(m => m.isCustom);
  
  // Combine mappedQuestions and customMaterials
  materials = [...mappedQuestions, ...customMaterials];
  
  // Also keep the original defaultMaterials if they are not duplicates
  defaultMaterials.forEach(dm => {
    const normDm = { ...dm, category: getNormalizedCategory(dm.category) };
    if (!materials.some(m => m.title.toLowerCase() === normDm.title.toLowerCase())) {
      materials.unshift(normDm);
    }
  });

  // Apply normalization to any loaded materials just in case
  materials.forEach(m => {
    m.category = getNormalizedCategory(m.category);
  });

  saveMaterials();

  const storedHistory = localStorage.getItem("fizika_history");
  if (storedHistory) {
    userHistory = JSON.parse(storedHistory);
  } else {
    userHistory = [];
  }
}

function saveMaterials() {
  localStorage.setItem("fizika_materials", JSON.stringify(materials));
}

function saveHistory() {
  localStorage.setItem("fizika_history", JSON.stringify(userHistory));
}

// ==========================================================================
// Text Processing & Smart Evaluation Algos
// ==========================================================================

function normalizeText(text) {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?'"\n\r]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getWordStem(word) {
  let cleaned = word.trim().toLowerCase();
  if (cleaned.length <= 3) return cleaned;

  let changed = true;
  while (changed) {
    changed = false;
    for (let suffix of azSuffixes) {
      if (cleaned.endsWith(suffix) && cleaned.length - suffix.length >= 3) {
        cleaned = cleaned.substring(0, cleaned.length - suffix.length);
        changed = true;
        break;
      }
    }
  }
  return cleaned;
}

function extractKeywords(text, count = 8) {
  const normalized = normalizeText(text);
  const words = normalized.split(" ");
  const freq = {};

  words.forEach(w => {
    if (w.length > 3 && !azStopWords.has(w)) {
      const stem = getWordStem(w);
      freq[stem] = (freq[stem] || 0) + 1;
    }
  });

  const sortedStems = Object.keys(freq).sort((a, b) => freq[b] - freq[a]);
  return sortedStems.slice(0, count);
}

function autoGenerateQuestionsFromText(title, content) {
  const sentences = content.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 15);
  const generated = [];

  const patterns = [
    { term: "deyilir", qType: "Tərif" },
    { term: "adlanır", qType: "Adlandırma" },
    { term: "bərabərdir", qType: "Hesablama" },
    { term: "ifadə olunur", qType: "Düstur" },
    { term: "düsturu", qType: "Düstur" }
  ];

  sentences.forEach((sentence, index) => {
    let matchedPattern = null;
    for (let p of patterns) {
      if (sentence.toLowerCase().includes(p.term)) {
        matchedPattern = p;
        break;
      }
    }

    if (matchedPattern) {
      let concept = "";
      if (sentence.includes(" - ")) {
        concept = sentence.split(" - ")[0].trim();
      } else if (sentence.includes(" – ")) {
        concept = sentence.split(" – ")[0].trim();
      } else {
        concept = sentence.split(" ").slice(0, 3).join(" ");
      }

      concept = concept.replace(/^[«"'\s]+|[»"'\s]+$/g, "");

      if (concept.length > 2 && concept.length < 40) {
        let questionText = "";
        if (matchedPattern.qType === "Tərif" || matchedPattern.qType === "Adlandırma") {
          questionText = `${concept} nədir və onun tərifi necədir?`;
        } else if (matchedPattern.qType === "Hesablama") {
          questionText = `${concept} necə hesablanır və nəyə bərabərdir?`;
        } else {
          questionText = `${concept} haqqında ətraflı məlumat verin.`;
        }

        const keywords = extractKeywords(sentence, 6);

        if (keywords.length >= 3) {
          generated.push({
            id: `auto-q-${Date.now()}-${index}`,
            question: questionText,
            templateAnswer: sentence,
            keywords: keywords
          });
        }
      }
    }
  });

  if (generated.length === 0) {
    const mainKeywords = extractKeywords(content, 8);
    generated.push({
      id: `auto-q-${Date.now()}-fallback-1`,
      question: `"${title}" mövzusunun əsas məzmununu öz sözlərinizlə ətraflı izah edin.`,
      templateAnswer: content.split(".").slice(0, 3).join(".") + ".",
      keywords: mainKeywords.slice(0, 5)
    });
  }

  return generated.slice(0, 4);
}

// Core Evaluation Engine
function evaluateAnswer(userAnswer, templateAnswer, expectedKeywords) {
  const normalizedUser = normalizeText(userAnswer);
  const userWords = normalizedUser.split(" ").filter(w => w.length > 0);
  const userStems = userWords.map(w => getWordStem(w));

  let matchedKeywords = [];
  let missedKeywords = [];

  expectedKeywords.forEach(keyword => {
    const keyStem = getWordStem(keyword.toLowerCase());
    let isMatched = false;
    
    for (let i = 0; i < userStems.length; i++) {
      const uStem = userStems[i];
      const uWord = userWords[i];
      
      if (uStem === keyStem || 
          uWord.includes(keyword.toLowerCase()) || 
          keyword.toLowerCase().includes(uWord) ||
          (keyStem.length >= 4 && uStem.startsWith(keyStem)) ||
          (uStem.length >= 4 && keyStem.startsWith(uStem))) {
        isMatched = true;
        break;
      }
    }

    if (isMatched) {
      matchedKeywords.push(keyword);
    } else {
      missedKeywords.push(keyword);
    }
  });

  const keywordMatchRatio = expectedKeywords.length > 0 
    ? matchedKeywords.length / expectedKeywords.length 
    : 0;

  const templateKeywords = extractKeywords(templateAnswer, 15);
  let templateMatches = 0;
  templateKeywords.forEach(tk => {
    if (userStems.includes(tk)) {
      templateMatches++;
    }
  });

  const generalOverlapRatio = templateKeywords.length > 0
    ? templateMatches / templateKeywords.length
    : 0;

  let accuracyScore = (keywordMatchRatio * 0.7) + (generalOverlapRatio * 0.3);
  accuracyScore = Math.min(100, Math.round(accuracyScore * 100));

  const userWordCount = userWords.length;
  const templateWordCount = normalizeText(templateAnswer).split(" ").length;
  
  const targetWordCount = Math.max(10, Math.round(templateWordCount * 0.5));
  let volumeScore = Math.min(100, Math.round((userWordCount / targetWordCount) * 100));

  if (accuracyScore < 20) {
    volumeScore = Math.min(volumeScore, accuracyScore * 2);
  }

  const overallScore = Math.round((accuracyScore * 0.6) + (volumeScore * 0.4));

  let grade = "F";
  if (overallScore >= 90) grade = "A";
  else if (overallScore >= 80) grade = "B";
  else if (overallScore >= 70) grade = "C";
  else if (overallScore >= 60) grade = "D";
  else if (overallScore >= 50) grade = "E";

  let feedbackText = "";
  if (overallScore >= 90) {
    feedbackText = "Mükəmməl! Mövzunu tam və dolğun mənimsəmisiniz. Əsas terminlər və elmi ifadələr qeyd olunub.";
  } else if (overallScore >= 75) {
    feedbackText = "Çox yaxşı. Cavabınız əsas anlayışları əhatə edir. Həcm və dolğunluq səviyyəsi qənaətbəxşdir.";
  } else if (overallScore >= 50) {
    feedbackText = "Kafi. Mövzunun ümumi mahiyyətini başa düşmüsünüz, lakin bəzi mühüm fiziki terminlər və düsturlar unudulub.";
  } else {
    feedbackText = "Qeyri-kafi. Cavabınızda mövzuya aid əsas açar sözlər çatışmır və ya çox qısa yazılıb. Təkrar etməyiniz vacibdir.";
  }

  return {
    accuracy: accuracyScore,
    volume: volumeScore,
    score: overallScore,
    grade: grade,
    feedback: feedbackText,
    matchedKeywords,
    missedKeywords
  };
}

// ==========================================================================
// Event Listeners & Tab Navigation
// ==========================================================================

function setupEventListeners() {
  // Tab Switching
  const navBtns = document.querySelectorAll(".nav-menu .nav-btn");
  navBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const tabId = btn.getAttribute("data-tab");
      switchTab(tabId);
    });
  });

  // Search & Filters (Library)
  const searchInput = document.getElementById("search-input");
  searchInput.addEventListener("input", filterMaterials);

  const filterTags = document.querySelectorAll("#category-filters .filter-tag");
  filterTags.forEach(tag => {
    tag.addEventListener("click", () => {
      filterTags.forEach(t => t.classList.remove("active"));
      tag.classList.add("active");
      filterMaterials();
    });
  });

  // Modal actions
  document.getElementById("btn-close-modal").addEventListener("click", closeModal);
  document.getElementById("btn-start-study").addEventListener("click", () => {
    const materialId = document.getElementById("material-detail-modal").getAttribute("data-material-id");
    closeModal();
    startQuiz(materialId);
  });
  document.getElementById("btn-delete-material").addEventListener("click", () => {
    const materialId = document.getElementById("material-detail-modal").getAttribute("data-material-id");
    if (confirm("Bu materialı silmək istədiyinizdən əminsiniz?")) {
      deleteMaterial(materialId);
      closeModal();
    }
  });

  // Topic Quiz Actions
  document.getElementById("btn-exit-quiz").addEventListener("click", () => {
    if (confirm("Sual-cavabdan çıxmaq istəyirsiniz? İndiki tərəqqiniz yadda saxlanmayacaq.")) {
      exitQuiz();
    }
  });
  document.getElementById("btn-quiz-skip").addEventListener("click", skipQuestion);
  document.getElementById("btn-quiz-submit").addEventListener("click", submitAnswer);
  document.getElementById("btn-next-question").addEventListener("click", nextQuestion);
  
  // Topic Quiz Completion Actions
  document.getElementById("btn-completion-finish").addEventListener("click", exitQuiz);
  document.getElementById("btn-completion-retry").addEventListener("click", () => {
    const matId = currentQuiz.material.id;
    exitQuiz();
    startQuiz(matId);
  });

  // Form: Auto-generate toggle
  const autoGenCheckbox = document.getElementById("auto-generate-questions");
  const manualWrapper = document.getElementById("manual-questions-container");
  autoGenCheckbox.addEventListener("change", () => {
    if (autoGenCheckbox.checked) {
      manualWrapper.classList.add("hidden");
    } else {
      manualWrapper.classList.remove("hidden");
      const list = document.getElementById("questions-list");
      if (list.children.length === 0) {
        addManualQuestionField();
      }
    }
  });

  // Form: Add manual question
  document.getElementById("btn-add-manual-q").addEventListener("click", () => addManualQuestionField());

  // Form: Word counter for textarea
  const contentArea = document.getElementById("material-content");
  const wordCountSpan = document.getElementById("word-count-text");
  contentArea.addEventListener("input", () => {
    const words = contentArea.value.trim().split(/\s+/).filter(w => w.length > 0);
    wordCountSpan.textContent = `${words.length} söz`;
  });

  // Form: Save Material
  document.getElementById("upload-form").addEventListener("submit", handleFormSubmit);

  // Realtime word counter for quiz input
  const quizInput = document.getElementById("user-answer-input");
  const quizWordCounter = document.getElementById("answer-word-counter");
  quizInput.addEventListener("input", () => {
    const words = quizInput.value.trim().split(/\s+/).filter(w => w.length > 0);
    quizWordCounter.textContent = `${words.length} söz / min 10 tövsiyə olunur`;
  });

  // --- BSU Exam Simulator Event Listeners ---
  document.getElementById("btn-draw-random-ticket").addEventListener("click", () => {
    const randomIdx = Math.floor(Math.random() * bsuTickets.length);
    startExam(randomIdx + 1);
  });

  document.getElementById("btn-exit-exam").addEventListener("click", () => {
    if (confirm("İmtahandan çıxmaq istədiyinizdən əminsiniz? Cavablarınız silinəcək.")) {
      exitExam();
    }
  });

  document.getElementById("btn-exam-prev").addEventListener("click", () => {
    if (currentExam.currentQuestionIndex > 0) {
      saveExamDraft();
      currentExam.currentQuestionIndex--;
      showExamQuestion();
    }
  });

  document.getElementById("btn-exam-next").addEventListener("click", () => {
    if (currentExam.currentQuestionIndex < 4) {
      saveExamDraft();
      currentExam.currentQuestionIndex++;
      showExamQuestion();
    }
  });

  document.getElementById("btn-exam-submit-all").addEventListener("click", () => {
    if (confirm("Bütün bilet suallarını cavablandırmısınızsa, imtahanı tamamlaya bilərsiniz. Yoxlanışa göndərilsin?")) {
      submitExam();
    }
  });

  // Realtime word counter for exam input
  const examInput = document.getElementById("exam-answer-input");
  const examWordCounter = document.getElementById("exam-answer-word-counter");
  examInput.addEventListener("input", () => {
    const words = examInput.value.trim().split(/\s+/).filter(w => w.length > 0);
    examWordCounter.textContent = `${words.length} söz`;
  });

  // Exam completion actions
  document.getElementById("btn-exam-completion-finish").addEventListener("click", exitExam);
  document.getElementById("btn-exam-completion-retry").addEventListener("click", () => {
    const tNum = currentExam.ticketNumber;
    exitExam();
    startExam(tNum);
  });

  // --- Metodik Vesait Event Listeners ---
  const guideSearchInput = document.getElementById("guide-search-input");
  guideSearchInput.addEventListener("input", filterGuideContent);

  const btnShowRehber = document.getElementById("btn-show-rehber");
  const btnShowQuestions = document.getElementById("btn-show-questions");
  const btnShowFormulas = document.getElementById("btn-show-formulas");

  btnShowRehber.addEventListener("click", () => {
    btnShowRehber.classList.add("active");
    btnShowQuestions.classList.remove("active");
    btnShowFormulas.classList.remove("active");
    document.getElementById("guide-rehber-accordion").classList.remove("hidden");
    document.getElementById("guide-questions-accordion").classList.add("hidden");
    document.getElementById("guide-formulas-view").classList.add("hidden");
    filterGuideContent();
  });

  btnShowQuestions.addEventListener("click", () => {
    btnShowRehber.classList.remove("active");
    btnShowQuestions.classList.add("active");
    btnShowFormulas.classList.remove("active");
    document.getElementById("guide-rehber-accordion").classList.add("hidden");
    document.getElementById("guide-questions-accordion").classList.remove("hidden");
    document.getElementById("guide-formulas-view").classList.add("hidden");
    filterGuideContent();
  });

  btnShowFormulas.addEventListener("click", () => {
    btnShowRehber.classList.remove("active");
    btnShowQuestions.classList.remove("active");
    btnShowFormulas.classList.add("active");
    document.getElementById("guide-rehber-accordion").classList.add("hidden");
    document.getElementById("guide-questions-accordion").classList.add("hidden");
    document.getElementById("guide-formulas-view").classList.remove("hidden");
    filterGuideContent();
  });

  // --- Multiple Choice Quiz Event Listeners ---
  document.getElementById("btn-start-mc-quiz").addEventListener("click", startMcQuiz);
  document.getElementById("btn-exit-mc-quiz").addEventListener("click", exitMcQuiz);
  document.getElementById("btn-next-mc-q").addEventListener("click", nextMcQuestion);
  document.getElementById("btn-retry-mc-quiz").addEventListener("click", startMcQuiz);
  document.getElementById("btn-finish-mc-quiz").addEventListener("click", exitMcQuiz);

  // --- Matching Game Event Listeners ---
  document.getElementById("btn-start-matching").addEventListener("click", startMatching);
  document.getElementById("btn-exit-matching").addEventListener("click", exitMatching);
  document.getElementById("btn-retry-matching").addEventListener("click", startMatching);
  document.getElementById("btn-finish-matching").addEventListener("click", exitMatching);
}

function switchTab(tabId) {
  // Update sidebar active state
  document.querySelectorAll(".nav-menu .nav-btn").forEach(btn => {
    btn.classList.remove("active");
    if (btn.getAttribute("data-tab") === tabId) {
      btn.classList.add("active");
    }
  });

  // Update headers
  const title = document.getElementById("header-title");
  const desc = document.getElementById("header-desc");
  
  if (tabId === "library") {
    title.textContent = "Mövzu Kitabxanası";
    desc.textContent = "Öyrənmək istədiyiniz fizika mövzusunu seçin və ya yenisini əlavə edin.";
  } else if (tabId === "simulator") {
    title.textContent = "BSU İmtahan Simulyatoru";
    desc.textContent = "Rəsmi imtahan biletləri modelində özünüzü sınayın və vaxt limitində imtahan verin.";
  } else if (tabId === "guide") {
    title.textContent = "Metodik Vəsait və 40 Sual";
    desc.textContent = "Kafedranın elmi-metodik rəhbərini və imtahana aid 40 sual-cavabı oxuyun.";
  } else if (tabId === "upload") {
    title.textContent = "Material Yüklə";
    desc.textContent = "Yeni dərslik materialı daxil edərək öz sual-cavab bazanızı qurun.";
  } else if (tabId === "analytics") {
    title.textContent = "Nəticələrim & Statistika";
    desc.textContent = "İndiyədək göstərdiyiniz nəticələr və inkişaf qrafikiniz.";
  } else if (tabId === "mc-quiz") {
    title.textContent = "Test İmtahanı (Quiz)";
    desc.textContent = "Müxtəlif mövzulardan seçilmiş 10 suallıq test ilə biliklərinizi sınayın.";
  } else if (tabId === "matching") {
    title.textContent = "Uyğunlaşdırma Oyunu";
    desc.textContent = "Fiziki anlayışlar ilə onların müvafiq düsturlarını sürətli şəkildə cütləşdirin.";
  }

  // Switch content visibility
  document.querySelectorAll(".tab-content").forEach(tc => {
    tc.classList.remove("active");
  });
  const targetTab = document.getElementById(`tab-${tabId}`);
  if (targetTab) {
    targetTab.classList.add("active");
  }

  // Hide quiz/exam containers
  document.getElementById("quiz-container").classList.add("hidden");
  document.getElementById("exam-simulator-container").classList.add("hidden");
  document.querySelector(".main-content").style.maxWidth = "1400px";
}

// ==========================================================================
// Rendering Material Cards
// ==========================================================================

function renderMaterials() {
  const grid = document.getElementById("materials-grid");
  grid.innerHTML = "";

  if (materials.length === 0) {
    grid.innerHTML = `
      <div class="card" style="grid-column: 1/-1; text-align: center; padding: 4rem;">
        <h3>Heç bir material yoxdur</h3>
        <p class="card-subtitle">Yeni öyrənmə materialı əlavə edərək dərhal başlayın!</p>
        <button class="btn btn-primary" onclick="switchTab('upload')">Məlumat Yüklə</button>
      </div>
    `;
    return;
  }

  materials.forEach(mat => {
    const card = document.createElement("div");
    card.className = "card material-card";
    card.setAttribute("data-id", mat.id);
    
    let badgeColor = "badge-indigo";
    if (mat.category === "Molekulyar Fizika") badgeColor = "badge-blue";
    if (mat.category === "Termodinamika") badgeColor = "badge-purple";
    if (mat.category === "Geofizika tətbiqi") badgeColor = "badge-purple";
    if (mat.category === "Seysmik Dalğalar") badgeColor = "badge-blue";
    if (mat.isCustom) badgeColor = "badge-purple";

    card.innerHTML = `
      <div>
        <div class="card-header-meta">
          <span class="badge ${badgeColor}">${mat.category}</span>
          ${mat.isCustom ? '<span style="font-size: 0.75rem; color: var(--color-accent); font-weight:600;">İstifadəçi</span>' : ''}
        </div>
        <h3>${mat.title}</h3>
        <p>${mat.description || mat.content.substring(0, 100) + '...'}</p>
      </div>
      <div class="card-footer-stats">
        <span class="questions-count-pill">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/></svg>
          ${mat.questions.length} Sual
        </span>
        <span style="color: var(--color-primary); font-weight: 600; display:flex; align-items:center; gap:4px;">
          Nəzərdən keçir 
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </span>
      </div>
    `;

    card.addEventListener("click", () => showMaterialModal(mat.id));
    grid.appendChild(card);
  });
}

function filterMaterials() {
  const query = document.getElementById("search-input").value.toLowerCase();
  const activeCategory = document.querySelector("#category-filters .filter-tag.active").getAttribute("data-category");

  const cards = document.querySelectorAll(".material-card");
  
  cards.forEach(card => {
    const id = card.getAttribute("data-id");
    const mat = materials.find(m => m.id === id);
    if (!mat) return;

    const matchesSearch = mat.title.toLowerCase().includes(query) || 
                          mat.content.toLowerCase().includes(query) ||
                          (mat.description && mat.description.toLowerCase().includes(query));
    
    let matchesCategory = false;
    if (activeCategory === "all") {
      matchesCategory = true;
    } else if (activeCategory === "custom") {
      matchesCategory = mat.isCustom === true;
    } else {
      matchesCategory = mat.category === activeCategory;
    }

    if (matchesSearch && matchesCategory) {
      card.style.display = "flex";
    } else {
      card.style.display = "none";
    }
  });
}

function showMaterialModal(id) {
  const mat = materials.find(m => m.id === id);
  if (!mat) return;

  const modal = document.getElementById("material-detail-modal");
  modal.setAttribute("data-material-id", mat.id);
  
  document.getElementById("modal-material-title").textContent = mat.title;
  document.getElementById("modal-material-content").textContent = mat.content;
  document.getElementById("modal-questions-count").textContent = `${mat.questions.length} sual var`;

  const categoryBadge = document.getElementById("modal-material-category");
  categoryBadge.textContent = mat.category;
  categoryBadge.className = "badge " + (
    mat.category === "Molekulyar Fizika" ? "badge-blue" : 
    mat.category === "Termodinamika" ? "badge-purple" : 
    mat.category === "Geofizika tətbiqi" ? "badge-purple" :
    mat.category === "Seysmik Dalğalar" ? "badge-blue" :
    "badge-indigo"
  );

  const deleteBtn = document.getElementById("btn-delete-material");
  if (mat.isCustom) {
    deleteBtn.style.display = "block";
  } else {
    deleteBtn.style.display = "none";
  }

  modal.classList.remove("hidden");
}

function closeModal() {
  document.getElementById("material-detail-modal").classList.add("hidden");
}

function deleteMaterial(id) {
  materials = materials.filter(m => m.id !== id);
  saveMaterials();
  renderMaterials();
}

// ==========================================================================
// Form Add Material Handling
// ==========================================================================

let manualQuestionCount = 0;

function addManualQuestionField() {
  manualQuestionCount++;
  const list = document.getElementById("questions-list");
  
  const item = document.createElement("div");
  item.className = "manual-q-item";
  item.id = `q-item-${manualQuestionCount}`;
  
  item.innerHTML = `
    <button type="button" class="btn-remove-q" onclick="removeManualQuestionField('${item.id}')">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
    <div class="form-group" style="margin-right: 2rem;">
      <label>Sual ${list.children.length + 1}</label>
      <input type="text" class="manual-question-text" required placeholder="Sualı yazın (məs. Arximed qüvvəsi necə yaranır?)">
    </div>
    <div class="form-group" style="margin-right: 2rem; margin-top: 0.5rem;">
      <label>Gözlənilən Doğru Cavab Şablonu</label>
      <textarea class="manual-question-answer" required rows="2" placeholder="Doğru tərif..."></textarea>
    </div>
  `;
  
  list.appendChild(item);
  reindexQuestionLabels();
}

function removeManualQuestionField(itemId) {
  const item = document.getElementById(itemId);
  if (item) {
    item.remove();
    reindexQuestionLabels();
  }
}

function reindexQuestionLabels() {
  const items = document.querySelectorAll(".manual-q-item");
  items.forEach((item, index) => {
    const label = item.querySelector("label");
    if (label) label.textContent = `Sual ${index + 1}`;
  });
}

function handleFormSubmit(e) {
  e.preventDefault();
  
  const title = document.getElementById("material-title").value.trim();
  const category = document.getElementById("material-category").value;
  const desc = document.getElementById("material-desc").value.trim();
  const content = document.getElementById("material-content").value.trim();
  const autoGen = document.getElementById("auto-generate-questions").checked;

  if (content.split(/\s+/).filter(w => w.length > 0).length < 15) {
    alert("Daxil etdiyiniz material çox qısadır (ən azı 15 söz daxil edin).");
    return;
  }

  let finalQuestions = [];

  if (autoGen) {
    finalQuestions = autoGenerateQuestionsFromText(title, content);
  } else {
    const qItems = document.querySelectorAll(".manual-q-item");
    qItems.forEach((item, index) => {
      const qText = item.querySelector(".manual-question-text").value.trim();
      const aText = item.querySelector(".manual-question-answer").value.trim();
      
      if (qText && aText) {
        const keywords = extractKeywords(aText, 7);
        finalQuestions.push({
          id: `manual-q-${Date.now()}-${index}`,
          question: qText,
          templateAnswer: aText,
          keywords: keywords
        });
      }
    });
  }

  if (finalQuestions.length === 0) {
    alert("Mövzu üçün heç bir sual təyin edilmədi.");
    return;
  }

  const newMaterial = {
    id: `material-${Date.now()}`,
    title: title,
    category: category,
    description: desc || content.substring(0, 100) + "...",
    content: content,
    questions: finalQuestions,
    isCustom: true
  };

  materials.push(newMaterial);
  saveMaterials();
  
  document.getElementById("upload-form").reset();
  document.getElementById("questions-list").innerHTML = "";
  document.getElementById("word-count-text").textContent = "0 söz";
  
  alert("Material uğurla əlavə edildi!");
  renderMaterials();
  switchTab("library");
}

// ==========================================================================
// Topic Quiz Gameplay Engine
// ==========================================================================

function startQuiz(materialId) {
  const mat = materials.find(m => m.id === materialId);
  if (!mat) return;

  if (mat.questions.length === 0) {
    alert("Bu materialda sual yoxdur!");
    return;
  }

  currentQuiz.material = mat;
  currentQuiz.questions = [...mat.questions];
  currentQuiz.currentQuestionIndex = 0;
  currentQuiz.answers = [];

  document.querySelectorAll(".tab-content").forEach(tc => tc.classList.remove("active"));
  document.getElementById("quiz-container").classList.remove("hidden");
  document.getElementById("quiz-question-view").classList.remove("hidden");
  document.getElementById("feedback-panel").classList.add("hidden");
  document.getElementById("quiz-completion-view").classList.add("hidden");
  
  document.querySelector(".main-content").style.maxWidth = "900px";

  showQuizQuestion();
}

function showQuizQuestion() {
  const index = currentQuiz.currentQuestionIndex;
  const q = currentQuiz.questions[index];
  
  document.getElementById("quiz-material-title").textContent = currentQuiz.material.title;
  document.getElementById("quiz-material-category").textContent = currentQuiz.material.category;
  document.getElementById("current-q-num").textContent = index + 1;
  document.getElementById("total-q-num").textContent = currentQuiz.questions.length;
  
  const pct = ((index) / currentQuiz.questions.length) * 100;
  document.getElementById("quiz-progress-fill").style.width = `${pct}%`;

  document.getElementById("q-num-label").textContent = index + 1;
  document.getElementById("question-text").textContent = q.question;
  
  const textarea = document.getElementById("user-answer-input");
  textarea.value = "";
  textarea.disabled = false;
  document.getElementById("answer-word-counter").textContent = "0 söz / min 10 tövsiyə olunur";
  
  document.getElementById("btn-quiz-skip").style.display = "inline-flex";
  document.getElementById("btn-quiz-submit").style.display = "inline-flex";
  
  document.getElementById("quiz-question-view").classList.remove("hidden");
  document.getElementById("feedback-panel").classList.add("hidden");
}

function skipQuestion() {
  const index = currentQuiz.currentQuestionIndex;
  const q = currentQuiz.questions[index];

  currentQuiz.answers.push({
    questionId: q.id,
    userAnswer: "[Buraxılıb]",
    accuracy: 0,
    volume: 0,
    score: 0,
    grade: "F",
    feedback: "Sual cavablandırılmadan ötürülüb.",
    matchedKeywords: [],
    missedKeywords: q.keywords
  });

  advanceQuiz();
}

function submitAnswer() {
  const textarea = document.getElementById("user-answer-input");
  const userAnswer = textarea.value.trim();

  if (userAnswer.length < 5) {
    alert("Zəhmət olmasa qiymətləndirmə üçün bir cavab yazın.");
    return;
  }

  const index = currentQuiz.currentQuestionIndex;
  const q = currentQuiz.questions[index];

  const evalResult = evaluateAnswer(userAnswer, q.templateAnswer, q.keywords);

  currentQuiz.answers.push({
    questionId: q.id,
    userAnswer: userAnswer,
    ...evalResult
  });

  showQuestionFeedback(evalResult, q.templateAnswer, userAnswer);
}

function showQuestionFeedback(evalResult, expectedAnswer, userAnswer) {
  document.getElementById("quiz-question-view").classList.add("hidden");
  document.getElementById("feedback-panel").classList.remove("hidden");

  animateRing("ring-accuracy", evalResult.accuracy, "val-accuracy");
  animateRing("ring-volume", evalResult.volume, "val-volume");

  const gradeEl = document.getElementById("val-grade");
  gradeEl.textContent = evalResult.grade;
  gradeEl.style.background = getGradeGradient(evalResult.grade);
  gradeEl.style.webkitBackgroundClip = "text";
  
  document.getElementById("val-overall-score").textContent = `${evalResult.score} / 100 xal`;
  document.getElementById("feedback-text-desc").textContent = evalResult.feedback;

  const tagsContainer = document.getElementById("keyword-tags-container");
  tagsContainer.innerHTML = "";
  
  if (evalResult.matchedKeywords.length === 0 && evalResult.missedKeywords.length === 0) {
    tagsContainer.innerHTML = `<span style="color: var(--text-muted); font-size:0.9rem;">Bu sual üçün əsas termin yoxdur.</span>`;
  }

  evalResult.matchedKeywords.forEach(kw => {
    const tag = document.createElement("span");
    tag.className = "tag-feedback matched";
    tag.innerHTML = `✓ ${kw}`;
    tagsContainer.appendChild(tag);
  });

  evalResult.missedKeywords.forEach(kw => {
    const tag = document.createElement("span");
    tag.className = "tag-feedback missed";
    tag.innerHTML = `✗ ${kw}`;
    tagsContainer.appendChild(tag);
  });

  document.getElementById("display-user-answer").textContent = userAnswer;
  document.getElementById("display-expected-answer").textContent = expectedAnswer;

  const nextBtn = document.getElementById("btn-next-question");
  if (currentQuiz.currentQuestionIndex === currentQuiz.questions.length - 1) {
    nextBtn.textContent = "İmtahanı Tamamla";
  } else {
    nextBtn.textContent = "Növbəti Suala Keç";
  }
}

function animateRing(ringId, scorePercentage, labelId) {
  const circle = document.getElementById(ringId);
  const label = document.getElementById(labelId);
  if (!circle || !label) return;

  const radius = circle.r.baseVal.value;
  const circumference = 2 * Math.PI * radius;
  
  circle.style.strokeDasharray = `${circumference}`;
  const offset = circumference - (scorePercentage / 100) * circumference;
  circle.style.strokeDashoffset = `${circumference}`;
  
  setTimeout(() => {
    circle.style.strokeDashoffset = `${offset}`;
    label.textContent = `${scorePercentage}%`;
  }, 100);
}

function getGradeGradient(grade) {
  if (grade === "A") return "linear-gradient(135deg, #fbbf24, #f59e0b)";
  if (grade === "B") return "linear-gradient(135deg, #10b981, #059669)";
  if (grade === "C") return "linear-gradient(135deg, #6366f1, #3b82f6)";
  if (grade === "D") return "linear-gradient(135deg, #f59e0b, #d97706)";
  return "linear-gradient(135deg, #ef4444, #b91c1c)";
}

function nextQuestion() {
  if (currentQuiz.currentQuestionIndex === currentQuiz.questions.length - 1) {
    finishQuiz();
  } else {
    currentQuiz.currentQuestionIndex++;
    showQuizQuestion();
  }
}

function advanceQuiz() {
  if (currentQuiz.currentQuestionIndex === currentQuiz.questions.length - 1) {
    finishQuiz();
  } else {
    currentQuiz.currentQuestionIndex++;
    showQuizQuestion();
  }
}

function finishQuiz() {
  document.getElementById("quiz-progress-fill").style.width = "100%";

  const totalQuestions = currentQuiz.answers.length;
  let sumAccuracy = 0;
  let sumVolume = 0;
  let sumScore = 0;

  currentQuiz.answers.forEach(ans => {
    sumAccuracy += ans.accuracy;
    sumVolume += ans.volume;
    sumScore += ans.score;
  });

  const avgAccuracy = Math.round(sumAccuracy / totalQuestions);
  const avgVolume = Math.round(sumVolume / totalQuestions);
  const avgScore = Math.round(sumScore / totalQuestions);

  let finalGrade = "F";
  if (avgScore >= 90) finalGrade = "A";
  else if (avgScore >= 80) finalGrade = "B";
  else if (avgScore >= 70) finalGrade = "C";
  else if (avgScore >= 60) finalGrade = "D";
  else if (avgScore >= 50) finalGrade = "E";

  const xpEarned = Math.round(avgScore * 0.8 * totalQuestions);

  document.getElementById("quiz-question-view").classList.add("hidden");
  document.getElementById("feedback-panel").classList.add("hidden");
  
  const completionView = document.getElementById("quiz-completion-view");
  completionView.classList.remove("hidden");

  document.getElementById("completion-subtitle").textContent = `"${currentQuiz.material.title}" mövzusu üzrə hazırlığı tamamladınız.`;
  document.getElementById("total-val-accuracy").textContent = `${avgAccuracy}%`;
  document.getElementById("total-val-volume").textContent = `${avgVolume}%`;
  document.getElementById("total-val-grade").textContent = finalGrade;
  
  const gradeEl = document.getElementById("total-val-grade");
  gradeEl.style.color = getGradeColor(finalGrade);

  document.getElementById("total-points-added").textContent = `+${xpEarned} XP`;

  const testRecord = {
    id: `test-${Date.now()}`,
    type: "Məşq",
    materialId: currentQuiz.material.id,
    materialTitle: currentQuiz.material.title,
    date: new Date().toLocaleDateString("az-AZ", { year: 'numeric', month: 'long', day: 'numeric' }),
    accuracy: avgAccuracy,
    volume: avgVolume,
    score: avgScore,
    grade: finalGrade,
    xp: xpEarned
  };

  userHistory.push(testRecord);
  saveHistory();

  let globalXP = parseInt(localStorage.getItem("fizika_global_xp") || "0");
  globalXP += xpEarned;
  localStorage.setItem("fizika_global_xp", globalXP.toString());

  updateGlobalStats();
  renderHistory();
}

function getGradeColor(grade) {
  if (grade === "A") return "var(--color-gold)";
  if (grade === "B") return "var(--color-success)";
  if (grade === "C") return "var(--color-primary)";
  if (grade === "D") return "var(--color-warning)";
  return "var(--color-danger)";
}

function exitQuiz() {
  currentQuiz = { material: null, questions: [], currentQuestionIndex: 0, answers: [] };
  switchTab("library");
}

// ==========================================================================
// BSU Exam Simulator Gameplay Engine
// ==========================================================================

function renderBsuTickets() {
  const grid = document.getElementById("tickets-grid");
  if (!grid) return;
  grid.innerHTML = "";

  // bsuTickets and bsuQuestions are loaded from extracted_data.js
  if (typeof bsuTickets === 'undefined' || bsuTickets.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; color: var(--text-muted);">Uğursuz: extracted_data.js yüklənməyib.</div>`;
    return;
  }

  bsuTickets.forEach(ticket => {
    const card = document.createElement("div");
    card.className = "ticket-card";
    
    // Extract categories of the 5 questions
    const categories = ticket.questionNumbers.map(num => {
      const qObj = bsuQuestions.find(q => q.number === num);
      return qObj ? qObj.category : "Fizika";
    });
    
    const uniqueCats = [...new Set(categories)].join(", ");

    card.innerHTML = `
      <div>
        <h3>Bilet № ${ticket.number}</h3>
        <div class="categories-list">Mövzular: <strong>${uniqueCats}</strong></div>
      </div>
      <button class="btn btn-outline" style="width: 100%; border-color: var(--color-primary); color: var(--color-primary);" onclick="startExam(${ticket.number})">
        İmtahanı Başla
      </button>
    `;
    
    grid.appendChild(card);
  });
}

function startExam(ticketNumber) {
  const ticketObj = bsuTickets.find(t => t.number === ticketNumber);
  if (!ticketObj) return;

  // Find the corresponding 5 questions
  const examQuestions = ticketObj.questionNumbers.map(num => {
    return bsuQuestions.find(q => q.number === num);
  }).filter(q => q !== undefined);

  if (examQuestions.length < 5) {
    alert("Xəta: Bilet sualları tam tapılmadı.");
    return;
  }

  // Initialize Exam State
  currentExam.ticketNumber = ticketNumber;
  currentExam.questions = examQuestions;
  currentExam.answers = ["", "", "", "", ""];
  currentExam.evaluations = [];
  currentExam.timerSeconds = 7200; // 120 minutes (2 hours)
  currentExam.currentQuestionIndex = 0;

  // Switch tabs/view
  document.querySelectorAll(".tab-content").forEach(tc => tc.classList.remove("active"));
  document.getElementById("exam-simulator-container").classList.remove("hidden");
  document.getElementById("exam-question-screen").classList.remove("hidden");
  document.getElementById("exam-results-screen").classList.add("hidden");
  document.getElementById("exam-active-inspector").classList.add("hidden");

  document.querySelector(".main-content").style.maxWidth = "950px";

  // Start Timer Countdown
  startExamTimer();

  // Render first question
  showExamQuestion();
}

function startExamTimer() {
  if (currentExam.timerInterval) clearInterval(currentExam.timerInterval);

  const clockEl = document.getElementById("exam-timer-clock");
  const wrapperEl = document.querySelector(".exam-timer-wrapper");
  wrapperEl.classList.remove("flashing");

  currentExam.timerInterval = setInterval(() => {
    currentExam.timerSeconds--;

    if (currentExam.timerSeconds <= 0) {
      clearInterval(currentExam.timerInterval);
      alert("Vaxt bitdi! İmtahan cavablarınız avtomatik qiymətləndirilməyə göndərilir.");
      submitExam();
      return;
    }

    // Format timer
    const mins = Math.floor(currentExam.timerSeconds / 60);
    const secs = currentExam.timerSeconds % 60;
    clockEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    // Flashing red warning if < 10 mins left (600 seconds)
    if (currentExam.timerSeconds <= 600) {
      wrapperEl.classList.add("flashing");
    }
  }, 1000);
}

function showExamQuestion() {
  const index = currentExam.currentQuestionIndex;
  const q = currentExam.questions[index];

  document.getElementById("exam-ticket-title").textContent = `Bilet № ${currentExam.ticketNumber}`;
  document.getElementById("exam-q-num-label").textContent = index + 1;
  document.getElementById("exam-question-text").textContent = `${q.number}. ${q.title}`;

  // Load draft answer
  const textarea = document.getElementById("exam-answer-input");
  textarea.value = currentExam.answers[index];
  
  // Update navigator dots
  const dots = document.querySelectorAll("#exam-nav-dots .nav-dot");
  dots.forEach((dot, dotIdx) => {
    dot.className = "nav-dot";
    if (dotIdx === index) dot.classList.add("active");
    if (currentExam.answers[dotIdx] && currentExam.answers[dotIdx].trim().length > 10) {
      dot.classList.add("answered");
    }
  });

  // Update word counter
  const words = textarea.value.trim().split(/\s+/).filter(w => w.length > 0);
  document.getElementById("exam-answer-word-counter").textContent = `${words.length} söz`;

  // Update Prev/Next button visibility
  document.getElementById("btn-exam-prev").style.visibility = (index === 0) ? "hidden" : "visible";
  document.getElementById("btn-exam-next").style.visibility = (index === 4) ? "hidden" : "visible";
}

function saveExamDraft() {
  const textarea = document.getElementById("exam-answer-input");
  const index = currentExam.currentQuestionIndex;
  currentExam.answers[index] = textarea.value.trim();
}

function submitExam() {
  saveExamDraft();
  clearInterval(currentExam.timerInterval);

  // Evaluate all 5 questions
  let totalScore = 0;
  let totalAccuracy = 0;
  let totalVolume = 0;

  currentExam.evaluations = currentExam.questions.map((q, idx) => {
    const userAnswer = currentExam.answers[idx];
    
    let result;
    if (!userAnswer || userAnswer.length < 5) {
      // Skipped or empty
      result = {
        accuracy: 0,
        volume: 0,
        score: 0,
        grade: "F",
        feedback: "Cavab yazılmayıb.",
        matchedKeywords: [],
        missedKeywords: q.keywords
      };
    } else {
      // Evaluate
      result = evaluateAnswer(userAnswer, q.content, q.keywords);
    }

    // Each question is worth max 20 points
    // bal = Math.round(overall_score / 100 * 20)
    const qScore = Math.round((result.score / 100) * 20);

    totalScore += qScore;
    totalAccuracy += result.accuracy;
    totalVolume += result.volume;

    return {
      questionTitle: q.title,
      questionNumber: q.number,
      userAnswer: userAnswer || "[Cavabsız]",
      expectedAnswer: q.content,
      qScore: qScore,
      ...result
    };
  });

  const avgAccuracy = Math.round(totalAccuracy / 5);
  const avgVolume = Math.round(totalVolume / 5);

  // Determine final exam grade (BSU style out of 100 points)
  let finalGrade = "F";
  if (totalScore >= 90) finalGrade = "A";
  else if (totalScore >= 80) finalGrade = "B";
  else if (totalScore >= 70) finalGrade = "C";
  else if (totalScore >= 60) finalGrade = "D";
  else if (totalScore >= 50) finalGrade = "E";

  const xpEarned = totalScore * 5; // e.g. 80 points = 400 XP

  // Save to history
  const examRecord = {
    id: `exam-${Date.now()}`,
    type: "İmtahan",
    materialId: `ticket-${currentExam.ticketNumber}`,
    materialTitle: `İmtahan: Bilet № ${currentExam.ticketNumber}`,
    date: new Date().toLocaleDateString("az-AZ", { year: 'numeric', month: 'long', day: 'numeric' }),
    accuracy: avgAccuracy,
    volume: avgVolume,
    score: totalScore,
    grade: finalGrade,
    xp: xpEarned
  };

  userHistory.push(examRecord);
  saveHistory();

  let globalXP = parseInt(localStorage.getItem("fizika_global_xp") || "0");
  globalXP += xpEarned;
  localStorage.setItem("fizika_global_xp", globalXP.toString());

  // Show results screen
  showExamResults(totalScore, avgAccuracy, finalGrade);
  updateGlobalStats();
  renderHistory();
}

function showExamResults(totalScore, avgAccuracy, finalGrade) {
  document.getElementById("exam-question-screen").classList.add("hidden");
  
  const resultsScreen = document.getElementById("exam-results-screen");
  resultsScreen.classList.remove("hidden");

  document.getElementById("exam-results-subtitle").textContent = `Bilet № ${currentExam.ticketNumber} imtahan transkripti`;
  document.getElementById("exam-total-score").textContent = `${totalScore} / 100`;
  document.getElementById("exam-avg-accuracy").textContent = `${avgAccuracy}%`;
  document.getElementById("exam-final-grade").textContent = finalGrade;

  const gradeEl = document.getElementById("exam-final-grade");
  gradeEl.style.color = getGradeColor(finalGrade);

  // Render question list breakdown
  const list = document.getElementById("exam-questions-score-list");
  list.innerHTML = "";

  currentExam.evaluations.forEach((evalObj, idx) => {
    const row = document.createElement("div");
    row.className = "exam-score-row";
    row.setAttribute("data-eval-idx", idx);

    let scoreColor = "rgba(239, 68, 68, 0.1)";
    let scoreTxtColor = "var(--color-danger)";
    if (evalObj.qScore >= 18) {
      scoreColor = "rgba(16, 185, 129, 0.1)";
      scoreTxtColor = "var(--color-success)";
    } else if (evalObj.qScore >= 12) {
      scoreColor = "rgba(99, 102, 241, 0.1)";
      scoreTxtColor = "var(--color-primary)";
    } else if (evalObj.qScore >= 8) {
      scoreColor = "rgba(245, 158, 11, 0.1)";
      scoreTxtColor = "var(--color-warning)";
    }

    row.innerHTML = `
      <span class="q-text">${evalObj.questionNumber}. ${evalObj.questionTitle}</span>
      <span class="score-pill" style="background-color:${scoreColor}; color:${scoreTxtColor};">
        ${evalObj.qScore} / 20 bal
      </span>
    `;

    row.addEventListener("click", () => inspectExamQuestion(idx));
    list.appendChild(row);
  });

  // Open first question details by default
  inspectExamQuestion(0);
}

function inspectExamQuestion(idx) {
  const rows = document.querySelectorAll(".exam-score-row");
  rows.forEach(r => r.classList.remove("active"));
  
  const selectedRow = document.querySelector(`.exam-score-row[data-eval-idx="${idx}"]`);
  if (selectedRow) selectedRow.classList.add("active");

  const evalObj = currentExam.evaluations[idx];
  
  document.getElementById("exam-active-inspector").classList.remove("hidden");
  document.getElementById("inspector-q-title").textContent = `${evalObj.questionNumber}. ${evalObj.questionTitle}`;
  document.getElementById("inspect-q-score").textContent = `${evalObj.qScore} / 20 bal`;

  // Animate mini score rings (using standard 201px circumference since radius is 32)
  const circleAcc = document.getElementById("inspect-ring-accuracy");
  const circleVol = document.getElementById("inspect-ring-volume");
  
  const circ = 2 * Math.PI * 32; // 201
  circleAcc.style.strokeDasharray = `${circ}`;
  circleVol.style.strokeDasharray = `${circ}`;
  
  circleAcc.style.strokeDashoffset = `${circ - (evalObj.accuracy / 100) * circ}`;
  circleVol.style.strokeDashoffset = `${circ - (evalObj.volume / 100) * circ}`;

  document.getElementById("inspect-val-accuracy").textContent = `${evalObj.accuracy}%`;
  document.getElementById("inspect-val-volume").textContent = `${evalObj.volume}%`;

  // Render keywords
  const tagContainer = document.getElementById("inspect-keyword-tags");
  tagContainer.innerHTML = "";

  evalObj.matchedKeywords.forEach(kw => {
    const t = document.createElement("span");
    t.className = "tag-feedback matched";
    t.textContent = `✓ ${kw}`;
    tagContainer.appendChild(t);
  });

  evalObj.missedKeywords.forEach(kw => {
    const t = document.createElement("span");
    t.className = "tag-feedback missed";
    t.textContent = `✗ ${kw}`;
    tagContainer.appendChild(t);
  });

  // Render answers text
  document.getElementById("inspect-user-answer").textContent = evalObj.userAnswer;
  document.getElementById("inspect-expected-answer").textContent = evalObj.expectedAnswer;
}

function exitExam() {
  clearInterval(currentExam.timerInterval);
  currentExam = { ticketNumber: 0, questions: [], answers: ["", "", "", "", ""], evaluations: [], timerSeconds: 7200, timerInterval: null, currentQuestionIndex: 0 };
  
  // Update main content width
  document.querySelector(".main-content").style.maxWidth = "1400px";
  
  switchTab("simulator");
}

// ==========================================================================
// Metodik Vesait / Guide Section Rendering
// ==========================================================================

function renderGuideSections() {
  const container = document.getElementById("guide-rehber-accordion");
  if (!container) return;
  container.innerHTML = "";

  if (typeof bsuRehberSections === 'undefined' || bsuRehberSections.length === 0) {
    container.innerHTML = `<div style="padding:2rem; color:var(--text-muted);">Metodik vəsait bölmələri tapılmadı.</div>`;
    return;
  }

  bsuRehberSections.forEach(sec => {
    const item = document.createElement("div");
    item.className = "accordion-item";
    item.setAttribute("data-type", "rehber");
    item.setAttribute("data-id", sec.id);

    // Format content: convert markdown headers or bold text if any
    const formattedContent = sec.content
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n•\s*(.*?)/g, '<br>• $1');

    item.innerHTML = `
      <div class="accordion-header" onclick="toggleAccordion(this)">
        <span>Bölüm ${sec.number}: ${sec.title}</span>
        <svg class="accordion-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="accordion-content">
        <p>${formattedContent}</p>
      </div>
    `;

    container.appendChild(item);
  });
}

function renderGuideQuestions() {
  const container = document.getElementById("guide-questions-accordion");
  if (!container) return;
  container.innerHTML = "";

  if (typeof bsuQuestions === 'undefined' || bsuQuestions.length === 0) {
    return;
  }

  bsuQuestions.forEach(q => {
    const item = document.createElement("div");
    item.className = "accordion-item";
    item.setAttribute("data-type", "question");
    item.setAttribute("data-id", q.id);

    // Render keyword badges
    const kwBadges = q.keywords.map(k => `<span class="badge badge-indigo" style="font-size:0.7rem; text-transform:none; margin-right:4px;">${k}</span>`).join("");

    item.innerHTML = `
      <div class="accordion-header" onclick="toggleAccordion(this)">
        <span>Sual ${q.number}: ${q.title}</span>
        <svg class="accordion-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="accordion-content">
        <div style="margin-bottom:1rem; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:0.75rem;">
          <span style="font-size:0.8rem; color:var(--text-muted); font-weight:600; text-transform:uppercase;">Kateqoriya:</span> 
          <span class="badge badge-blue" style="font-size:0.7rem;">${q.category}</span>
        </div>
        <p style="font-size:0.95rem; line-height:1.6; white-space:pre-wrap;">${q.content}</p>
        <div style="margin-top:1.5rem; border-top:1px solid rgba(255,255,255,0.05); padding-top:0.75rem;">
          <span style="font-size:0.8rem; color:var(--text-muted); font-weight:600; display:block; margin-bottom:0.5rem;">Sistem yoxlaması üçün əsas açar sözlər:</span>
          <div>${kwBadges}</div>
        </div>
      </div>
    `;

    container.appendChild(item);
  });
}

function renderFormulasTable() {
  const tbody = document.getElementById("formulas-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (typeof bsuFormulas === 'undefined' || bsuFormulas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="empty-table-text">Düstur cədvəli boşdur.</td></tr>`;
    return;
  }

  bsuFormulas.forEach(f => {
    // Parse the raw line: typically "Name   Formula   Explanation"
    // We split by tab or multiple spaces
    const parts = f.raw.split(/\s{2,}/);
    if (parts.length >= 2) {
      const tr = document.createElement("tr");
      tr.className = "formula-row";
      tr.innerHTML = `
        <td style="font-weight:600; color:var(--text-main);">${parts[0]}</td>
        <td style="font-weight:700; color:var(--color-secondary); font-family:monospace; font-size:1.05rem;">${parts[1]}</td>
        <td style="color:var(--text-muted); font-size:0.85rem;">${parts.slice(2).join(" ")}</td>
      `;
      tbody.appendChild(tr);
    }
  });
}

function toggleAccordion(header) {
  const item = header.parentElement;
  const content = item.querySelector(".accordion-content");
  
  const isOpen = item.classList.contains("open");
  
  // Close all other accordions in the same container
  const container = item.parentElement;
  container.querySelectorAll(".accordion-item").forEach(otherItem => {
    otherItem.classList.remove("open");
    const otherContent = otherItem.querySelector(".accordion-content");
    if (otherContent) otherContent.style.maxHeight = null;
  });

  if (!isOpen) {
    item.classList.add("open");
    // Calculate scroll height + padding
    content.style.maxHeight = content.scrollHeight + 50 + "px";
  } else {
    item.classList.remove("open");
    content.style.maxHeight = null;
  }
}

function filterGuideContent() {
  const query = document.getElementById("guide-search-input").value.toLowerCase();
  
  // Determine which list is visible
  const activeGuideTab = document.querySelector(".guide-toggle-buttons .filter-tag.active").textContent;
  
  if (activeGuideTab.includes("Metodik")) {
    const items = document.querySelectorAll("#guide-rehber-accordion .accordion-item");
    items.forEach(item => {
      const text = item.textContent.toLowerCase();
      if (text.includes(query)) {
        item.style.display = "block";
      } else {
        item.style.display = "none";
      }
    });
  } else if (activeGuideTab.includes("Sualları")) {
    const items = document.querySelectorAll("#guide-questions-accordion .accordion-item");
    items.forEach(item => {
      const text = item.textContent.toLowerCase();
      if (text.includes(query)) {
        item.style.display = "block";
      } else {
        item.style.display = "none";
      }
    });
  } else {
    // Formulas
    const rows = document.querySelectorAll("#formulas-table-body tr");
    rows.forEach(row => {
      const text = row.textContent.toLowerCase();
      if (text.includes(query)) {
        row.style.display = "table-row";
      } else {
        row.style.display = "none";
      }
    });
  }
}

// ==========================================================================
// Stats & History Dashboard Rendering
// ==========================================================================

function updateGlobalStats() {
  const globalXP = localStorage.getItem("fizika_global_xp") || "0";
  document.getElementById("global-score").textContent = `${globalXP} XP`;

  const totalTests = userHistory.length;
  document.getElementById("stat-total-tests").textContent = totalTests;

  if (totalTests > 0) {
    let sumAcc = 0;
    userHistory.forEach(h => sumAcc += h.accuracy);
    const avg = Math.round(sumAcc / totalTests);
    document.getElementById("stat-avg-accuracy").textContent = `${avg}%`;
  } else {
    document.getElementById("stat-avg-accuracy").textContent = "0%";
  }

  document.getElementById("stat-total-materials").textContent = materials.length;

  const rankSpan = document.querySelector(".user-rank");
  const xp = parseInt(globalXP);
  if (xp >= 1500) {
    rankSpan.textContent = "Fizika Alimi";
  } else if (xp >= 800) {
    rankSpan.textContent = "Fizika Magistri";
  } else if (xp >= 300) {
    rankSpan.textContent = "Bakalavr";
  } else {
    rankSpan.textContent = "Yeni Başlayan";
  }
}

function renderHistory() {
  const tbody = document.getElementById("history-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (userHistory.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-table-text">Hələ heç bir imtahan verməmisiniz. Kitabxanadan mövzu seçib başlayın!</td>
      </tr>
    `;
    return;
  }

  const sortedHistory = [...userHistory].reverse();

  sortedHistory.forEach(record => {
    const tr = document.createElement("tr");

    let typeColor = "badge-indigo";
    if (record.type === "İmtahan") typeColor = "badge-purple";

    let accColorClass = "text-green";
    if (record.score < 50) accColorClass = "text-red";
    else if (record.score < 75) accColorClass = "text-blue";

    let gradeColor = getGradeColor(record.grade);

    tr.innerHTML = `
      <td><span class="badge ${typeColor}">${record.type || 'Məşq'}</span></td>
      <td style="font-weight:600;">${record.materialTitle}</td>
      <td style="color:var(--text-muted); font-size:0.85rem;">${record.date}</td>
      <td class="${accColorClass}" style="font-weight:600;">${record.score} bal</td>
      <td>
        <span class="badge" style="background-color:rgba(255,255,255,0.03); color:${gradeColor}; border:1px solid ${gradeColor}; font-size:0.9rem; padding:0.2rem 0.6rem;">
          ${record.grade}
        </span>
      </td>
      <td>
        <button class="btn btn-outline" style="padding:0.4rem 0.8rem; font-size:0.8rem; border-radius:8px;" onclick="deleteHistoryRecord('${record.id}')">Sil</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function deleteHistoryRecord(id) {
  if (confirm("Bu imtahan nəticəsini silmək istəyirsiniz?")) {
    const record = userHistory.find(h => h.id === id);
    if (record) {
      let globalXP = parseInt(localStorage.getItem("fizika_global_xp") || "0");
      globalXP = Math.max(0, globalXP - record.xp);
      localStorage.setItem("fizika_global_xp", globalXP.toString());
    }

    userHistory = userHistory.filter(h => h.id !== id);
    saveHistory();
    updateGlobalStats();
    renderHistory();
  }
}

// ==========================================================================
// Multiple Choice Quiz & Matching Game Data and Logic
// ==========================================================================

const bsuMultipleChoiceQuestions = [
  {
    question: "Cismə digər cisimlər təsir etmirsə və ya onların təsiri bir-birini kompensasiya edirsə, onun öz hərəkət sürətini saxlamaq xassəsi necə adlanır?",
    options: ["İmpuls", "İnersiya", "Təcil", "Reaktiv hərəkət"],
    answerIndex: 1
  },
  {
    question: "Mexaniki işin riyazi ifadəsi hansıdır?",
    options: ["A = F * s * cos(α)", "P = F * v", "Ek = m * v^2 / 2", "Ep = m * g * h"],
    answerIndex: 0
  },
  {
    question: "Gücün Beynəlxalq Vahidlər Sistemində (BS) vahidi nədir?",
    options: ["Coul", "Nyuton", "Vatt", "Paskal"],
    answerIndex: 2
  },
  {
    question: "Təcil hansı fiziki kəmiyyətin zamana görə birinci tərtib törəməsidir?",
    options: ["Koordinatın", "Sürətin", "İmpulsun", "Qüvvənin"],
    answerIndex: 1
  },
  {
    question: "Normal təcil hansı düsturla hesablanır?",
    options: ["a = dv/dt", "a = v^2 / R", "a = ω^2 * R", "a = R * β"],
    answerIndex: 1
  },
  {
    question: "Qapalı sistemdə mexaniki enerjinin saxlanması qanunu hansı qüvvələr təsir etdikdə ödənilir?",
    options: ["Sürtünmə qüvvələri", "Yalnız konservativ qüvvələr", "Qeyri-konservativ qüvvələr", "Müqavimət qüvvələri"],
    answerIndex: 1
  },
  {
    question: "Arximed qüvvəsi hansı parametrlərdən asılıdır?",
    options: [
      "Mayenin sıxlığı, sərbəstdüşmə təcili və cismin batan hissəsinin həcmi",
      "Cismin kütləsi, mayenin sıxlığı və səth sahəsi",
      "Cismin ümumi həcmi, havanın sıxlığı və təzyiq",
      "Mayenin özlülüyü, sərbəstdüşmə təcili və temperatur"
    ],
    answerIndex: 0
  },
  {
    question: "Maye sütununun yaratdığı hidrostatik təzyiqin düsturu hansıdır?",
    options: ["P = F / S", "P = ρ * g * h", "P = m * g", "P = P0 + ρ * v^2 / 2"],
    answerIndex: 1
  },
  {
    question: "İdeal qazın hal tənliyi (Mendeleyev-Klapeyron) hansıdır?",
    options: ["PV = νRT", "PV = const", "P/T = const", "V/T = const"],
    answerIndex: 0
  },
  {
    question: "İkiatomlu ideal qazın sərbəstlik dərəcəsi (i) neçəyə bərabərdir?",
    options: ["3", "5", "6", "4"],
    answerIndex: 1
  },
  {
    question: "Doymuş buxarın əsas xüsusiyyəti nədir?",
    options: [
      "Təzyiqi temperaturdan asılı deyil",
      "Təzyiqi sabit temperaturda həcmdən asılı deyil",
      "Həcmi artdıqda təzyiqi də artır",
      "İdeal qaz qanunlarına tam tabedir"
    ],
    answerIndex: 1
  },
  {
    question: "Mayenin qaynaması üçün hansı şərt ödənilməlidir?",
    options: [
      "Doymuş buxarının təzyiqi xarici təzyiqə bərabər və ya ondan böyük olmalıdır",
      "Mayenin temperaturu 100°C olmalıdır",
      "Mayenin sıxlığı buxarın sıxlığından kiçik olmalıdır",
      "Maye qapalı qabda saxlanılmalıdır"
    ],
    answerIndex: 0
  },
  {
    question: "Seysmik eninə dalğalar (S-dalğaları) hansı mühitdə yayıla bilər?",
    options: ["Yalnız mayelərdə", "Yalnız bərk cisimlərdə", "Qazlarda və mayelərdə", "Bütün mühitlərdə"],
    answerIndex: 1
  },
  {
    question: "Mütləq qeyri-elastiki toqquşmada hansı kəmiyyət saxlanılmır?",
    options: ["İmpuls", "Kinetik enerji", "Ümumi kütlə", "Heç biri"],
    answerIndex: 1
  },
  {
    question: "Harmonik rəqslərin təcili koordinatdan necə asılıdır?",
    options: [
      "Koordinatla düz mütənasibdir və eyni istiqamətdədir",
      "Koordinatla düz mütənasibdir və əks istiqamətdədir",
      "Koordinatın kvadratı ilə tərs mütənasibdir",
      "Koordinatdan asılı deyil"
    ],
    answerIndex: 1
  },
  {
    question: "Süxurların gərginlik və nisbi deformasiyası arasındakı əlaqəni göstərən Xuk qanunu hansıdır?",
    options: ["σ = E * ε", "F = -k * x", "tau = G * γ", "σ = E / ε"],
    answerIndex: 0
  },
  {
    question: "Məsaməli mühitdə yeraltı suların və neftin süzülmə sürətini təyin edən qanun hansıdır?",
    options: ["Bernulli qanunu", "Darsi qanunu", "Nyuton qanunu", "Fik qanunu"],
    answerIndex: 1
  },
  {
    question: "Yeraltı laylarda süxurların ağırlığı ilə yaranan təzyiq necə adlanır?",
    options: ["Hidrostatik təzyiq", "Litostatik təzyiq", "Kapilyar təzyiq", "Atmosfer təzyiqi"],
    answerIndex: 1
  },
  {
    question: "Qapalı sistemdə real (dönməyən) proseslər zamanı entropiya necə dəyişir?",
    options: ["Azalır", "Artır", "Sabit qalır", "Sıfıra bərabər olur"],
    answerIndex: 1
  },
  {
    question: "Riyazi rəqqasın rəqs dövrünün düsturu hansıdır?",
    options: ["T = 2*π*√(l/g)", "T = 2*π*√(g/l)", "T = 2*π*√(m/k)", "T = 1/ν"],
    answerIndex: 0
  }
];

// Multiple Choice Quiz State
let mcQuizState = {
  questions: [],
  currentQuestionIndex: 0,
  score: 0,
  correctCount: 0,
  wrongCount: 0,
  userSelections: []
};

// Matching Game State
let matchingState = {
  pairs: [],
  shuffledLeft: [],
  shuffledRight: [],
  selectedLeftIndex: null,
  selectedRightIndex: null,
  matchedCount: 0,
  timerInterval: null,
  timeLeft: 30
};

// Predefined match pairs (Term -> Formula/Definition)
const matchingSourcePairs = [
  { term: "Kinetik Enerji", match: "m * v^2 / 2" },
  { term: "Mexaniki İş", match: "F * s * cos(α)" },
  { term: "Arximed Qüvvəsi", match: "rho * g * V" },
  { term: "İdeal Qaz Hal Tənliyi", match: "P * V = nu * R * T" },
  { term: "Nyutonun II Qanunu", match: "F = m * a" },
  { term: "Potensial Enerji", match: "m * g * h" },
  { term: "Güc", match: "A / t" },
  { term: "Cismin İmpulsy", match: "m * v" },
  { term: "Xuk Qanunu", match: "sigma = E * epsilon" },
  { term: "Darsi Qanunu", match: "v = -(k/mu) * dP/dx" },
  { term: "Bernulli Tənliyi", match: "P + rho*v^2/2 + rho*g*h = const" },
  { term: "Sürtünmə Qüvvəsi", match: "mu * N" }
];

// Multiple Choice Quiz Functions
function startMcQuiz() {
  const shuffled = [...bsuMultipleChoiceQuestions].sort(() => 0.5 - Math.random());
  mcQuizState.questions = shuffled.slice(0, 10);
  mcQuizState.currentQuestionIndex = 0;
  mcQuizState.score = 0;
  mcQuizState.correctCount = 0;
  mcQuizState.wrongCount = 0;
  mcQuizState.userSelections = [];

  document.getElementById("tab-mc-quiz").querySelector(".quiz-intro-card").classList.add("hidden");
  document.getElementById("mc-quiz-active").classList.remove("hidden");
  document.getElementById("mc-quiz-results").classList.add("hidden");

  showMcQuestion();
}

function showMcQuestion() {
  const index = mcQuizState.currentQuestionIndex;
  const q = mcQuizState.questions[index];

  document.getElementById("mc-current-q").textContent = index + 1;
  const pct = (index / 10) * 100;
  document.getElementById("mc-progress-fill").style.width = `${pct}%`;

  document.getElementById("mc-question-text").textContent = q.question;

  const grid = document.getElementById("mc-options-grid");
  grid.innerHTML = "";

  const nextBtn = document.getElementById("btn-next-mc-q");
  nextBtn.classList.add("hidden");

  const letters = ["A", "B", "C", "D"];
  q.options.forEach((opt, idx) => {
    const btn = document.createElement("button");
    btn.className = "mc-option-btn";
    btn.innerHTML = `
      <span class="option-letter">${letters[idx]}</span>
      <span class="option-text">${opt}</span>
    `;
    btn.addEventListener("click", () => selectMcOption(idx));
    grid.appendChild(btn);
  });
}

function selectMcOption(selectedIdx) {
  const index = mcQuizState.currentQuestionIndex;
  const q = mcQuizState.questions[index];

  const buttons = document.querySelectorAll("#mc-options-grid .mc-option-btn");
  buttons.forEach(btn => btn.classList.add("disabled"));

  const selectedBtn = buttons[selectedIdx];
  const correctBtn = buttons[q.answerIndex];

  if (selectedIdx === q.answerIndex) {
    selectedBtn.classList.add("correct");
    mcQuizState.correctCount++;
    mcQuizState.score += 10;
  } else {
    selectedBtn.classList.add("incorrect");
    correctBtn.classList.add("correct");
    mcQuizState.wrongCount++;
  }

  const nextBtn = document.getElementById("btn-next-mc-q");
  nextBtn.classList.remove("hidden");
  if (index === 9) {
    nextBtn.textContent = "Nəticəni Gör";
  } else {
    nextBtn.textContent = "Növbəti Sual";
  }
}

function nextMcQuestion() {
  if (mcQuizState.currentQuestionIndex === 9) {
    finishMcQuiz();
  } else {
    mcQuizState.currentQuestionIndex++;
    showMcQuestion();
  }
}

function finishMcQuiz() {
  document.getElementById("mc-progress-fill").style.width = "100%";
  document.getElementById("mc-quiz-active").classList.add("hidden");
  
  const results = document.getElementById("mc-quiz-results");
  results.classList.remove("hidden");

  const correct = mcQuizState.correctCount;
  const wrong = mcQuizState.wrongCount;
  const pct = correct * 10;
  const xpEarned = correct * 15; // 15 XP per correct answer

  document.getElementById("mc-result-subtitle").textContent = `10 sualdan ${correct}-ni doğru cavablandırdınız.`;
  document.getElementById("mc-correct-count").textContent = correct;
  document.getElementById("mc-wrong-count").textContent = wrong;
  document.getElementById("mc-score-pct").textContent = `${pct}%`;
  document.getElementById("mc-points-awarded").innerHTML = `Qazanılan Xal: <strong>+${xpEarned} XP</strong>`;

  const iconEl = document.getElementById("mc-result-icon");
  const titleEl = document.getElementById("mc-result-title");
  if (pct >= 80) {
    iconEl.textContent = "🏆";
    titleEl.textContent = "Mükəmməl Nəticə!";
  } else if (pct >= 50) {
    iconEl.textContent = "👏";
    titleEl.textContent = "Yaxşı Nəticə!";
  } else {
    iconEl.textContent = "📚";
    titleEl.textContent = "Daha çox çalışmalısınız!";
  }

  const testRecord = {
    id: `mc-quiz-${Date.now()}`,
    type: "Test",
    materialId: "mc-quiz-tab",
    materialTitle: "Test İmtahanı (Quiz)",
    date: new Date().toLocaleDateString("az-AZ", { year: 'numeric', month: 'long', day: 'numeric' }),
    accuracy: pct,
    volume: 100,
    score: pct,
    grade: pct >= 90 ? "A" : pct >= 80 ? "B" : pct >= 70 ? "C" : pct >= 60 ? "D" : pct >= 50 ? "E" : "F",
    xp: xpEarned
  };

  userHistory.push(testRecord);
  saveHistory();

  let globalXP = parseInt(localStorage.getItem("fizika_global_xp") || "0");
  globalXP += xpEarned;
  localStorage.setItem("fizika_global_xp", globalXP.toString());

  updateGlobalStats();
  renderHistory();
}

function exitMcQuiz() {
  document.getElementById("tab-mc-quiz").querySelector(".quiz-intro-card").classList.remove("hidden");
  document.getElementById("mc-quiz-active").classList.add("hidden");
  document.getElementById("mc-quiz-results").classList.add("hidden");
  switchTab("library");
}

// Matching Game Functions
function startMatching() {
  const shuffled = [...matchingSourcePairs].sort(() => 0.5 - Math.random());
  matchingState.pairs = shuffled.slice(0, 5);

  matchingState.shuffledLeft = [...matchingState.pairs].sort(() => 0.5 - Math.random());
  matchingState.shuffledRight = [...matchingState.pairs].sort(() => 0.5 - Math.random());

  matchingState.selectedLeftIndex = null;
  matchingState.selectedRightIndex = null;
  matchingState.matchedCount = 0;
  matchingState.timeLeft = 30;

  document.getElementById("tab-matching").querySelector(".matching-intro-card").classList.add("hidden");
  document.getElementById("matching-active").classList.remove("hidden");
  document.getElementById("matching-results").classList.add("hidden");

  document.getElementById("matching-current-score").textContent = "0";
  document.getElementById("matching-timer-sec").textContent = "30";

  renderMatchingItems();

  if (matchingState.timerInterval) clearInterval(matchingState.timerInterval);
  matchingState.timerInterval = setInterval(updateMatchingTimer, 1000);
}

function renderMatchingItems() {
  const leftCol = document.getElementById("matching-left-col");
  const rightCol = document.getElementById("matching-right-col");

  leftCol.innerHTML = "";
  rightCol.innerHTML = "";

  matchingState.shuffledLeft.forEach((item, idx) => {
    const card = document.createElement("div");
    card.className = "matching-card";
    card.textContent = item.term;
    card.setAttribute("data-index", idx);
    card.addEventListener("click", () => selectMatchingCard(card, "left", idx));
    leftCol.appendChild(card);
  });

  matchingState.shuffledRight.forEach((item, idx) => {
    const card = document.createElement("div");
    card.className = "matching-card";
    card.textContent = item.match;
    card.setAttribute("data-index", idx);
    card.addEventListener("click", () => selectMatchingCard(card, "right", idx));
    rightCol.appendChild(card);
  });
}

function selectMatchingCard(element, type, idx) {
  if (element.classList.contains("matched")) return;

  if (type === "left") {
    const prevSelected = document.querySelector("#matching-left-col .matching-card.selected");
    if (prevSelected) prevSelected.classList.remove("selected");

    if (matchingState.selectedLeftIndex === idx) {
      matchingState.selectedLeftIndex = null;
    } else {
      element.classList.add("selected");
      matchingState.selectedLeftIndex = idx;
    }
  } else {
    const prevSelected = document.querySelector("#matching-right-col .matching-card.selected");
    if (prevSelected) prevSelected.classList.remove("selected");

    if (matchingState.selectedRightIndex === idx) {
      matchingState.selectedRightIndex = null;
    } else {
      element.classList.add("selected");
      matchingState.selectedRightIndex = idx;
    }
  }

  if (matchingState.selectedLeftIndex !== null && matchingState.selectedRightIndex !== null) {
    checkMatchingPair();
  }
}

function checkMatchingPair() {
  const leftIdx = matchingState.selectedLeftIndex;
  const rightIdx = matchingState.selectedRightIndex;

  const leftItem = matchingState.shuffledLeft[leftIdx];
  const rightItem = matchingState.shuffledRight[rightIdx];

  const leftCard = document.querySelector(`#matching-left-col .matching-card[data-index="${leftIdx}"]`);
  const rightCard = document.querySelector(`#matching-right-col .matching-card[data-index="${rightIdx}"]`);

  leftCard.classList.remove("selected");
  rightCard.classList.remove("selected");

  matchingState.selectedLeftIndex = null;
  matchingState.selectedRightIndex = null;

  if (leftItem.term === rightItem.term) {
    leftCard.classList.add("matched");
    rightCard.classList.add("matched");
    matchingState.matchedCount++;
    document.getElementById("matching-current-score").textContent = matchingState.matchedCount;

    if (matchingState.matchedCount === 5) {
      clearInterval(matchingState.timerInterval);
      setTimeout(finishMatching, 500);
    }
  } else {
    leftCard.classList.add("wrong");
    rightCard.classList.add("wrong");
    
    document.querySelectorAll(".matching-card").forEach(c => c.style.pointerEvents = "none");

    setTimeout(() => {
      leftCard.classList.remove("wrong");
      rightCard.classList.remove("wrong");
      document.querySelectorAll(".matching-card").forEach(c => c.style.pointerEvents = "auto");
    }, 500);
  }
}

function updateMatchingTimer() {
  matchingState.timeLeft--;
  document.getElementById("matching-timer-sec").textContent = matchingState.timeLeft;

  if (matchingState.timeLeft <= 0) {
    clearInterval(matchingState.timerInterval);
    alert("Vaxt bitdi!");
    finishMatching();
  }
}

function finishMatching() {
  document.getElementById("matching-active").classList.add("hidden");
  const results = document.getElementById("matching-results");
  results.classList.remove("hidden");

  const correct = matchingState.matchedCount;
  const xpEarned = correct * 20; // 20 XP per correct match

  document.getElementById("matching-result-subtitle").textContent = `5 cütdən ${correct}-ni uğurla uyğunlaşdırdınız.`;
  document.getElementById("matching-points-awarded").innerHTML = `Qazanılan Xal: <strong>+${xpEarned} XP</strong>`;

  const iconEl = document.getElementById("matching-result-icon");
  const titleEl = document.getElementById("matching-result-title");
  if (correct === 5) {
    iconEl.textContent = "🎯";
    titleEl.textContent = "Əla nəticə!";
  } else {
    iconEl.textContent = "⏱️";
    titleEl.textContent = "Oyun bitdi!";
  }

  const testRecord = {
    id: `matching-${Date.now()}`,
    type: "Eşləşdirmə",
    materialId: "matching-tab",
    materialTitle: "Uyğunlaşdırma Oyunu",
    date: new Date().toLocaleDateString("az-AZ", { year: 'numeric', month: 'long', day: 'numeric' }),
    accuracy: correct * 20,
    volume: 100,
    score: correct * 20,
    grade: correct === 5 ? "A" : correct === 4 ? "B" : correct === 3 ? "C" : "F",
    xp: xpEarned
  };

  userHistory.push(testRecord);
  saveHistory();

  let globalXP = parseInt(localStorage.getItem("fizika_global_xp") || "0");
  globalXP += xpEarned;
  localStorage.setItem("fizika_global_xp", globalXP.toString());

  updateGlobalStats();
  renderHistory();
}

function exitMatching() {
  if (matchingState.timerInterval) clearInterval(matchingState.timerInterval);
  document.getElementById("tab-matching").querySelector(".matching-intro-card").classList.remove("hidden");
  document.getElementById("matching-active").classList.add("hidden");
  document.getElementById("matching-results").classList.add("hidden");
  switchTab("library");
}

// Client-side PDF Parser (PDF.js Integration)
function setupPdfUpload() {
  const uploadBox = document.getElementById("pdf-upload-box");
  const fileInput = document.getElementById("pdf-file-input");

  if (!uploadBox || !fileInput) return;

  // Set worker source
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
  }

  // Click to trigger input
  uploadBox.addEventListener("click", (e) => {
    if (e.target !== fileInput) {
      fileInput.click();
    }
  });

  // Drag and Drop events
  ["dragenter", "dragover"].forEach(eventName => {
    uploadBox.addEventListener(eventName, (e) => {
      e.preventDefault();
      uploadBox.classList.add("dragover");
    }, false);
  });

  ["dragleave", "drop"].forEach(eventName => {
    uploadBox.addEventListener(eventName, (e) => {
      e.preventDefault();
      uploadBox.classList.remove("dragover");
    }, false);
  });

  uploadBox.addEventListener("drop", (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0 && files[0].type === "application/pdf") {
      handlePdfFile(files[0]);
    } else {
      alert("Zəhmət olmasa yalnız PDF faylı yükləyin.");
    }
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) {
      handlePdfFile(fileInput.files[0]);
    }
  });
}

function handlePdfFile(file) {
  const statusEl = document.getElementById("pdf-upload-status");
  statusEl.classList.remove("hidden");
  statusEl.textContent = "PDF oxunur və mətn çıxarılır, zəhmət olmasa gözləyin...";
  
  // Set title from file name
  const titleInput = document.getElementById("material-title");
  if (titleInput && !titleInput.value) {
    const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "").replace(/_/g, " ");
    titleInput.value = nameWithoutExt.charAt(0).toUpperCase() + nameWithoutExt.slice(1);
  }

  const reader = new FileReader();
  reader.onload = async function () {
    try {
      const typedarray = new Uint8Array(this.result);
      const pdf = await pdfjsLib.getDocument({ data: typedarray }).promise;
      let fullText = "";

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        
        let lastY = null;
        let pageText = "";
        
        for (let item of textContent.items) {
          if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
            pageText += "\n";
          }
          pageText += item.str + " ";
          lastY = item.transform[5];
        }
        
        fullText += pageText + "\n\n";
      }

      const cleanText = fullText.replace(/\s+/g, " ").trim();
      const contentArea = document.getElementById("material-content");
      if (contentArea) {
        contentArea.value = cleanText;
        contentArea.dispatchEvent(new Event("input"));
      }

      statusEl.textContent = "Uğurlu! PDF mətni çıxarıldı.";
      setTimeout(() => statusEl.classList.add("hidden"), 3000);
    } catch (err) {
      console.error(err);
      statusEl.textContent = "Xəta: PDF oxunarkən problem yarandı.";
      alert("PDF faylından mətn çıxarmaq mümkün olmadı. Fayl şifrəli və ya skan edilmiş şəkil ola bilər.");
    }
  };

  reader.onerror = function () {
    statusEl.textContent = "Xəta: Fayl oxuna bilmədi.";
  };

  reader.readAsArrayBuffer(file);
}
