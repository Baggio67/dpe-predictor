// DPE Predictor - Application Controller

// Global state variables
let probChart = null;
let portfolioChart = null;
let renovationState = {
    isolation: false,
    heating: false
};

// Supabase client instance
let supabaseClient = null;

// Portfolio state variables
let importedBuildings = [];
let batchRenovationState = {
    isolation: false,
    heating: false
};

// DPE styling configurations
const DPE_CONFIG = {
    'A': { color: '#009B6A', textColor: '#ffffff', desc: 'Très performant', note: 'Excellente efficacité énergétique. Logement passif ou très récent.' },
    'B': { color: '#52B150', textColor: '#ffffff', desc: 'Performant', note: 'Bâtiment très bien isolé, souvent équipé d\'une pompe à chaleur.' },
    'C': { color: '#A5CA3B', textColor: '#ffffff', desc: 'Moyen', note: 'Logement standard, niveau d\'isolation correct.' },
    'D': { color: '#F3E200', textColor: '#000000', desc: 'Acceptable', note: 'Isolation moyenne. Consommation modérée mais améliorable.' },
    'E': { color: '#FEC200', textColor: '#000000', desc: 'Faible', note: 'Passoire thermique potentielle. Chauffage énergivore et isolation moyenne.' },
    'F': { color: '#EB8705', textColor: '#ffffff', desc: 'Mauvais', note: 'Passoire énergétique. Travaux d\'isolation urgents recommandés.' },
    'G': { color: '#D82200', textColor: '#ffffff', desc: 'Très mauvais', note: 'Logement extrêmement énergivore. Chauffage obsolète, aucune isolation.' }
};

// CO2 emission factors (kg CO2 per kWh of final energy)
const CO2_EMISSION_FACTORS = {
    'Electrique': 0.06,      // French grid mix (low carbon)
    'Gaz': 0.20,             // Natural gas
    'Fioul': 0.27,           // Fuel oil
    'Bois': 0.02,            // Wood
    'Pompe_a_chaleur': 0.06  // PAC (uses electricity)
};

// Initialize Application on Page Load
document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize math rendering using KaTeX
    initKaTeX();

    // 2. Initialize Model Accuracy Display
    if (typeof MODEL_PARAMS !== 'undefined') {
        document.getElementById('model-accuracy-val').textContent = (MODEL_PARAMS.accuracy * 100).toFixed(1) + '%';
    } else {
        console.error("Paramètres du modèle non trouvés. Les calculs utiliseront des données par défaut.");
        document.getElementById('model-accuracy-val').textContent = 'N/A';
    }

    // 3. Setup Navigation Tabs
    setupTabs();

    // 4. Initialize Single Calculator Chart
    initSingleChart();

    // 5. Bind Sliders and Form Inputs
    bindSingleEvents();

    // 6. Setup Single Renovation Simulator Buttons
    bindSingleRenovationEvents();

    // 7. Setup Portfolio Module (CSV)
    setupPortfolioModule();

    // 8. Setup Supabase database logging
    initSupabase();
    setupSupabaseUI();

    // 9. Run Initial Single Prediction
    updateSinglePrediction();
});

// Render math symbols via KaTeX
function initKaTeX() {
    try {
        if (window.katex) {
            // Render block math formulas
            const mathBlocks = document.querySelectorAll('.math-block');
            mathBlocks.forEach(block => {
                const tex = block.textContent.trim().replace(/^\$\$|\$\$$/g, '');
                window.katex.render(tex, block, { displayMode: true, throwOnError: false });
            });
            
            // Render inline math
            const mathInlines = document.querySelectorAll('.math-inline');
            mathInlines.forEach(inline => {
                const tex = inline.textContent.trim().replace(/^\(|\)$/g, '');
                window.katex.render(tex, inline, { displayMode: false, throwOnError: false });
            });
        }
    } catch (err) {
        console.warn("Erreur de rendu KaTeX: ", err);
    }
}

// Setup switching between tabs
function setupTabs() {
    const btnSingle = document.getElementById('tab-btn-single');
    const btnPortfolio = document.getElementById('tab-btn-portfolio');
    const tabSingle = document.getElementById('tab-single');
    const tabPortfolio = document.getElementById('tab-portfolio');

    btnSingle.addEventListener('click', () => {
        btnSingle.classList.add('active');
        btnPortfolio.classList.remove('active');
        tabSingle.style.display = 'block';
        tabPortfolio.style.display = 'none';
        // Fix: force chart redraw after layout change
        setTimeout(() => { if (probChart) probChart.resize(); }, 50);
    });

    btnPortfolio.addEventListener('click', () => {
        btnPortfolio.classList.add('active');
        btnSingle.classList.remove('active');
        tabPortfolio.style.display = 'block';
        tabSingle.style.display = 'none';
        setTimeout(() => { if (portfolioChart) portfolioChart.resize(); }, 50);
    });
}

// Initialize Chart.js for single probabilities
function initSingleChart() {
    const ctx = document.getElementById('probabilities-chart').getContext('2d');
    probChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
            datasets: [{
                label: 'Probabilité',
                data: [0, 0, 0, 0, 0, 0, 0],
                backgroundColor: [
                    DPE_CONFIG['A'].color,
                    DPE_CONFIG['B'].color,
                    DPE_CONFIG['C'].color,
                    DPE_CONFIG['D'].color,
                    DPE_CONFIG['E'].color,
                    DPE_CONFIG['F'].color,
                    DPE_CONFIG['G'].color
                ],
                borderRadius: 6,
                borderWidth: 0,
                barThickness: 18
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `Probabilité: ${(context.raw * 100).toFixed(1)}%`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    min: 0,
                    max: 1.0,
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: {
                        color: '#94a3b8',
                        callback: function(value) { return (value * 100) + '%'; }
                    }
                },
                y: {
                    grid: { display: false },
                    ticks: {
                        color: '#f8fafc',
                        font: { weight: 'bold', size: 13 }
                    }
                }
            }
        }
    });
}

// Bind standard input events for single prediction
function bindSingleEvents() {
    const inputs = [
        { id: 'input-surface', valId: 'val-surface', suffix: ' m²' },
        { id: 'input-pieces', valId: 'val-pieces', suffix: '' },
        { id: 'input-age', valId: 'val-age', suffix: ' ans' },
        { id: 'input-occupants', valId: 'val-occupants', suffix: '' },
        { id: 'input-consumption', valId: 'val-consumption', suffix: ' kWh', format: true }
    ];

    inputs.forEach(input => {
        const slider = document.getElementById(input.id);
        const display = document.getElementById(input.valId);

        slider.addEventListener('input', () => {
            let val = slider.value;
            if (input.format) {
                display.textContent = Number(val).toLocaleString('fr-FR') + input.suffix;
            } else {
                display.textContent = val + input.suffix;
            }
            updateSinglePrediction();
        });
    });

    document.getElementById('input-heating').addEventListener('change', updateSinglePrediction);
    document.getElementById('input-insulation').addEventListener('change', updateSinglePrediction);
}

// Bind renovation simulator buttons for single calculation
function bindSingleRenovationEvents() {
    const btnIsolation = document.getElementById('btn-renovate-isolation');
    const btnHeating = document.getElementById('btn-renovate-heating');
    const btnReset = document.getElementById('btn-reset-renovation');

    btnIsolation.addEventListener('click', () => {
        renovationState.isolation = !renovationState.isolation;
        btnIsolation.classList.toggle('active', renovationState.isolation);
        updateSinglePrediction();
    });

    btnHeating.addEventListener('click', () => {
        renovationState.heating = !renovationState.heating;
        btnHeating.classList.toggle('active', renovationState.heating);
        updateSinglePrediction();
    });

    btnReset.addEventListener('click', () => {
        renovationState.isolation = false;
        renovationState.heating = false;
        btnIsolation.classList.remove('active');
        btnHeating.classList.remove('active');
        updateSinglePrediction();
    });
}

// Core Prediction Calculator (Softmax Multi-class)
function computeModelPrediction(surface, pieces, age, occupants, consumption, heating, insulation) {
    if (typeof MODEL_PARAMS === 'undefined') {
        return { predictedClass: 'D', probabilities: [0.02, 0.05, 0.1, 0.6, 0.15, 0.05, 0.03], confidence: 0.6 };
    }

    // 1. One-hot encoding of categorical features
    const categories = {
        'heating_type_Electrique': heating === 'Electrique' ? 1.0 : 0.0,
        'heating_type_Gaz': heating === 'Gaz' ? 1.0 : 0.0,
        'heating_type_Fioul': heating === 'Fioul' ? 1.0 : 0.0,
        'heating_type_Bois': heating === 'Bois' ? 1.0 : 0.0,
        'heating_type_Pompe_a_chaleur': heating === 'Pompe_a_chaleur' ? 1.0 : 0.0,
        
        'insulation_Mauvaise': insulation === 'Mauvaise' ? 1.0 : 0.0,
        'insulation_Moyenne': insulation === 'Moyenne' ? 1.0 : 0.0,
        'insulation_Bonne': insulation === 'Bonne' ? 1.0 : 0.0,
        'insulation_Excellente': insulation === 'Excellente' ? 1.0 : 0.0
    };

    // 2. Build feature vector matching training columns
    const rawVector = [];
    MODEL_PARAMS.features.forEach(f => {
        if (f === 'surface') rawVector.push(surface);
        else if (f === 'pieces') rawVector.push(pieces);
        else if (f === 'age') rawVector.push(age);
        else if (f === 'occupants') rawVector.push(occupants);
        else if (f === 'annual_consumption') rawVector.push(consumption);
        else rawVector.push(categories[f]);
    });

    // 3. Standardization
    const scaledVector = [];
    for (let j = 0; j < rawVector.length; j++) {
        const mean = MODEL_PARAMS.means[j];
        const std = MODEL_PARAMS.stds[j];
        scaledVector.push((rawVector[j] - mean) / std);
    }

    // 4. Calculate log-odds scores
    const numClasses = MODEL_PARAMS.classes.length;
    const scores = new Array(numClasses).fill(0);
    for (let k = 0; k < numClasses; k++) {
        scores[k] = MODEL_PARAMS.intercepts[k];
        for (let j = 0; j < scaledVector.length; j++) {
            scores[k] += MODEL_PARAMS.coefs[k][j] * scaledVector[j];
        }
    }

    // 5. Softmax computation
    const expScores = scores.map(Math.exp);
    const sumExpScores = expScores.reduce((a, b) => a + b, 0);
    const probabilities = expScores.map(score => score / sumExpScores);

    // 6. Max probability index
    let maxProbIdx = 0;
    let maxProb = 0;
    for (let k = 0; k < numClasses; k++) {
        if (probabilities[k] > maxProb) {
            maxProb = probabilities[k];
            maxProbIdx = k;
        }
    }

    return {
        predictedClass: MODEL_PARAMS.classes[maxProbIdx],
        probabilities: probabilities,
        confidence: maxProb
    };
}

// Thermal and efficiency calculations for eco-renovation simulation
// renovState = { isolation: bool, heating: bool }
function calculateRenovatedConsumption(originalConsumption, originalHeating, originalInsulation, age, occupants, surface, renovState) {
    const waterAppEst = occupants * 850.0;
    let heatingPartEst = Math.max(0, originalConsumption - waterAppEst);
    
    let ageEffect = 0;
    if (age > 50) ageEffect = 70.0;
    else if (age > 20) ageEffect = 25.0;
    else if (age > 5) ageEffect = -10.0;
    else ageEffect = -40.0;

    const baseHeatNeed = 110.0;
    
    const getHeatingFactor = (hType) => {
        if (hType === 'Pompe_a_chaleur') return 0.32;
        if (hType === 'Bois') return 0.95;
        if (hType === 'Electrique') return 1.00;
        if (hType === 'Gaz') return 0.90;
        if (hType === 'Fioul') return 1.15;
        return 1.0;
    };
    
    const getIsoEffect = (iso) => {
        if (iso === 'Mauvaise') return 110.0;
        if (iso === 'Moyenne') return 40.0;
        if (iso === 'Bonne') return -20.0;
        if (iso === 'Excellente') return -60.0;
        return 0.0;
    };

    const currentHeatNeedPerM2 = Math.min(350.0, Math.max(20.0, baseHeatNeed + ageEffect + getIsoEffect(originalInsulation)));
    const targetInsulation = renovState.isolation ? 'Excellente' : originalInsulation;
    const targetHeatNeedPerM2 = Math.min(350.0, Math.max(20.0, baseHeatNeed + ageEffect + getIsoEffect(targetInsulation)));
    
    let renovatedHeatingPart = heatingPartEst * (targetHeatNeedPerM2 / currentHeatNeedPerM2);

    if (renovState.heating && originalHeating !== 'Pompe_a_chaleur') {
        const currentHeatingFactor = getHeatingFactor(originalHeating);
        const targetHeatingFactor = getHeatingFactor('Pompe_a_chaleur');
        renovatedHeatingPart = renovatedHeatingPart * (targetHeatingFactor / currentHeatingFactor);
    }

    return Math.round(renovatedHeatingPart + waterAppEst);
}

// Update UI and trigger prediction
function updateSinglePrediction() {
    const surface = parseFloat(document.getElementById('input-surface').value);
    const pieces = parseInt(document.getElementById('input-pieces').value);
    const age = parseFloat(document.getElementById('input-age').value);
    const occupants = parseInt(document.getElementById('input-occupants').value);
    const consumption = parseFloat(document.getElementById('input-consumption').value);
    const heating = document.getElementById('input-heating').value;
    const insulation = document.getElementById('input-insulation').value;

    const specificCons = (consumption / surface).toFixed(1);
    
    // Update text display
    const displayEl = document.getElementById('specific-cons-display');
    displayEl.querySelector('span:first-child').innerHTML = 
        `Consommation spécifique: <strong>${specificCons} kWh/m²/an</strong>`;

    // Update the threshold indicator position on the rainbow ruler
    // Map specificCons [0-600+] to [0%-100%] clamped
    const MAX_RULER = 600;
    const pct = Math.min(parseFloat(specificCons) / MAX_RULER * 100, 100);
    const indicator = document.getElementById('threshold-indicator');
    if (indicator) indicator.style.left = `${pct}%`;

    // Compute baseline prediction
    const baseline = computeModelPrediction(surface, pieces, age, occupants, consumption, heating, insulation);
    
    // Eco-renovation simulation
    let renovated = null;
    const comparisonContainer = document.getElementById('renov-comparison-container');
    
    if (renovationState.isolation || renovationState.heating) {
        const targetHeating = renovationState.heating ? 'Pompe_a_chaleur' : heating;
        const targetInsulation = renovationState.isolation ? 'Excellente' : insulation;
        
        const targetConsumption = calculateRenovatedConsumption(consumption, heating, insulation, age, occupants, surface, renovationState);

        renovated = computeModelPrediction(surface, pieces, age, occupants, targetConsumption, targetHeating, targetInsulation);
        
        comparisonContainer.style.display = 'flex';
        
        const origDpe = document.getElementById('original-dpe');
        origDpe.textContent = baseline.predictedClass;
        origDpe.style.backgroundColor = DPE_CONFIG[baseline.predictedClass].color;
        origDpe.style.color = DPE_CONFIG[baseline.predictedClass].textColor;
        
        const renovDpe = document.getElementById('renovated-dpe');
        renovDpe.textContent = renovated.predictedClass;
        renovDpe.style.backgroundColor = DPE_CONFIG[renovated.predictedClass].color;
        renovDpe.style.color = DPE_CONFIG[renovated.predictedClass].textColor;

        const savingsKwh = Math.max(0, consumption - targetConsumption);
        const savingsEuros = Math.round(savingsKwh * 0.25);
        document.getElementById('renovation-savings-text').innerHTML = 
            `Économie : <strong>-${savingsKwh.toLocaleString('fr-FR')} kWh/an</strong><br><span style="color: #10b981; font-size: 0.85rem;"><i class="fa-solid fa-arrow-trend-down"></i> env. <strong>${savingsEuros} € / an</strong></span>`;
    } else {
        comparisonContainer.style.display = 'none';
    }

    const activePred = baseline;
    const predictedLetterEl = document.getElementById('predicted-letter');
    const badgeBg = predictedLetterEl.parentElement;
    const cardEl = document.getElementById('main-result-card');
    
    predictedLetterEl.textContent = activePred.predictedClass;
    
    const config = DPE_CONFIG[activePred.predictedClass];
    badgeBg.style.backgroundColor = config.color;
    badgeBg.style.color = config.textColor;
    
    cardEl.className = 'card glass-card result-card';
    cardEl.classList.add(`glow-${activePred.predictedClass}`);
    
    document.getElementById('class-title').textContent = `Classe ${activePred.predictedClass} - ${config.desc}`;
    document.getElementById('class-description').textContent = config.note;
    document.getElementById('prediction-confidence').textContent = (activePred.confidence * 100).toFixed(1) + '%';

    // Scale nodes
    const nodes = document.querySelectorAll('.dpe-scale-node');
    nodes.forEach(node => {
        const cls = node.getAttribute('data-class');
        if (cls === activePred.predictedClass) {
            node.classList.add('active');
        } else {
            node.classList.remove('active');
        }
    });

    if (probChart) {
        probChart.data.datasets[0].data = activePred.probabilities;
        probChart.update();
    }

    // Supabase Logging
    if (supabaseClient) {
        logAuditToSupabaseDebounced(surface, pieces, age, occupants, consumption, heating, insulation, activePred.predictedClass, activePred.confidence);
    }
}

// -------------------------------------------------------
// Generate individual building printable report (opens print dialog)
// -------------------------------------------------------
function generateBuildingReport() {
    const surface = document.getElementById('input-surface').value;
    const pieces  = document.getElementById('input-pieces').value;
    const age     = document.getElementById('input-age').value;
    const occ     = document.getElementById('input-occupants').value;
    const cons    = Number(document.getElementById('input-consumption').value).toLocaleString('fr-FR');
    const heating = document.getElementById('input-heating').value.replace('_', ' ');
    const insul   = document.getElementById('input-insulation').value;
    const letter  = document.getElementById('predicted-letter').textContent;
    const conf    = document.getElementById('prediction-confidence').textContent;
    const desc    = document.getElementById('class-description').textContent;
    const specCons = document.getElementById('specific-cons-display').querySelector('strong').textContent;
    const cfg     = DPE_CONFIG[letter] || {};
    const now     = new Date().toLocaleDateString('fr-FR', {day:'2-digit',month:'long',year:'numeric'});

    const win = window.open('', '_blank');
    win.document.write(`
    <!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
    <title>Rapport DPE - Classe ${letter}</title>
    <style>
        body { font-family: 'Segoe UI', sans-serif; color: #1e293b; max-width: 800px; margin: 40px auto; padding: 0 2rem; }
        h1   { color: #0ea5e9; border-bottom: 3px solid #0ea5e9; padding-bottom: 0.5rem; }
        h2   { color: #0f172a; margin-top: 2rem; font-size: 1.1rem; text-transform: uppercase; letter-spacing: 0.05em; }
        table{ width: 100%; border-collapse: collapse; margin: 1rem 0; }
        th   { background: #f1f5f9; text-align: left; padding: 0.5rem 0.75rem; font-size: 0.85rem; color: #475569; }
        td   { padding: 0.5rem 0.75rem; border-bottom: 1px solid #e2e8f0; font-size: 0.95rem; }
        .badge { display: inline-block; padding: 0.5rem 2rem; border-radius: 8px; font-size: 3rem; font-weight: 900;
                 color: ${cfg.textColor || '#fff'}; background: ${cfg.color || '#888'}; }
        .footer{ margin-top: 3rem; font-size: 0.75rem; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 1rem; }
        @media print { body { margin: 0; } }
    </style></head><body>
    <h1>Rapport de Diagnostic de Performance Énergétique (DPE)</h1>
    <p>Date d'analyse : <strong>${now}</strong></p>
    <div style="display:flex;align-items:center;gap:2rem;margin:1.5rem 0">
        <div class="badge">${letter}</div>
        <div>
            <h2 style="margin:0">Classe ${letter} &mdash; ${cfg.desc || ''}</h2>
            <p style="color:#475569;margin:0.25rem 0">${desc}</p>
            <p style="color:#0ea5e9;font-weight:600;margin:0.25rem 0">Confiance du modèle : ${conf}</p>
        </div>
    </div>
    <h2>Caractéristiques du Bâtiment</h2>
    <table><thead><tr><th>Paramètre</th><th>Valeur</th></tr></thead><tbody>
        <tr><td>Surface habitable</td><td>${surface} m²</td></tr>
        <tr><td>Nombre de pièces</td><td>${pieces}</td></tr>
        <tr><td>Age du bâtiment</td><td>${age} ans</td></tr>
        <tr><td>Nombre d'occupants</td><td>${occ}</td></tr>
        <tr><td>Type de chauffage</td><td>${heating}</td></tr>
        <tr><td>Isolation thermique</td><td>${insul}</td></tr>
        <tr><td>Consommation annuelle</td><td>${cons} kWh/an</td></tr>
        <tr><td><strong>Consommation spécifique</strong></td><td><strong>${specCons}</strong></td></tr>
    </tbody></table>
    <h2>Seuils DPE de référence</h2>
    <table><thead><tr><th>Classe</th><th>Seuil (kWh/m²/an)</th><th>Qualification</th></tr></thead><tbody>
        <tr><td>A</td><td>≤ 70</td><td>Très performant</td></tr>
        <tr><td>B</td><td>71 – 110</td><td>Performant</td></tr>
        <tr><td>C</td><td>111 – 180</td><td>Moyen</td></tr>
        <tr><td>D</td><td>181 – 250</td><td>Acceptable</td></tr>
        <tr><td>E</td><td>251 – 330</td><td>Faible</td></tr>
        <tr><td>F</td><td>331 – 420</td><td>Mauvais</td></tr>
        <tr><td>G</td><td>&gt; 420</td><td>Très mauvais</td></tr>
    </tbody></table>
    <div class="footer">
        Généré par DPE Predictor &mdash; Modèle Régression Logistique Multinomiale (Accuracy 78.3%).
        Ce rapport est fourni à titre indicatif et ne se substitue pas à un diagnostic officiel agréé.
    </div>
    <script>window.onload=()=>window.print();<\/script></body></html>`);
    win.document.close();
}

// -------------------------------------------------------------
// INDUSTRIAL PORTFOLIO MODULE (CSV UPLOAD & BATCH ANALYSIS)
// -------------------------------------------------------------

function setupPortfolioModule() {
    const dropzone = document.getElementById('csv-dropzone');
    const fileInput = document.getElementById('csv-file-input');
    const searchInput = document.getElementById('table-search');

    // Drag and Drop Events
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    });

    // File Browse Event
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleFile(file);
    });

    // Search Filtering
    searchInput.addEventListener('input', () => {
        renderPortfolioTable(searchInput.value);
    });

    // Simulation buttons
    setupBatchSimulationEvents();
}

function handleFile(file) {
    const errorBox = document.getElementById('import-error-message');
    const errorText = document.getElementById('error-text');
    errorBox.style.display = 'none';

    if (!file.name.endsWith('.csv')) {
        errorText.textContent = "Seuls les fichiers avec extension .csv sont acceptés.";
        errorBox.style.display = 'flex';
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const text = e.target.result;
            const parsedData = parseCSV(text);
            
            if (parsedData.length === 0) {
                throw new Error("Le fichier CSV est vide ou illisible.");
            }

            // Validate header presence
            const requiredHeaders = ['surface', 'pieces', 'age', 'occupants', 'annual_consumption', 'heating_type', 'insulation'];
            const fileHeaders = Object.keys(parsedData[0]);
            const missing = requiredHeaders.filter(h => !fileHeaders.includes(h));

            if (missing.length > 0) {
                throw new Error(`En-têtes manquants dans le fichier : ${missing.join(', ')}`);
            }

            // Save records
            importedBuildings = parsedData.map((row, idx) => ({
                id: idx + 1,
                surface: parseFloat(row.surface),
                pieces: parseInt(row.pieces),
                age: parseFloat(row.age),
                occupants: parseInt(row.occupants),
                annualConsumption: parseFloat(row.annual_consumption),
                heatingType: row.heating_type.trim(),
                insulation: row.insulation.trim()
            }));

            // Reveal dashboard views
            document.getElementById('portfolio-dashboard-view').style.display = 'block';
            
            // Reset simulation states
            batchRenovationState.isolation = false;
            batchRenovationState.heating = false;
            document.getElementById('batch-isolation-btn').classList.remove('active');
            document.getElementById('batch-heating-btn').classList.remove('active');
            document.getElementById('batch-savings-box').style.display = 'none';

            // Run initial analytics
            updatePortfolioAnalytics();
            
            // Smooth scroll to results
            document.getElementById('portfolio-dashboard-view').scrollIntoView({ behavior: 'smooth' });

        } catch (err) {
            errorText.textContent = err.message;
            errorBox.style.display = 'flex';
            console.error(err);
        }
    };
    reader.readAsText(file, 'utf-8');
}

// Simple and robust local CSV Parser (handling comma/semicolon/tab, quotes, line returns)
function parseCSV(text) {
    const lines = text.split(/\r\n|\n/);
    if (lines.length === 0 || lines[0].trim() === '') return [];

    // Identify delimiter (, or ;)
    const headerLine = lines[0];
    let delimiter = ',';
    if (headerLine.includes(';')) delimiter = ';';
    else if (headerLine.includes('\t')) delimiter = '\t';

    const headers = headerLine.split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, ''));
    const records = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === '') continue;

        // Split preserving quotes is nice, but simple split handles our template and typical exports
        const values = line.split(delimiter).map(v => v.trim().replace(/^["']|["']$/g, ''));
        if (values.length < headers.length) continue;

        const record = {};
        headers.forEach((header, idx) => {
            record[header] = values[idx];
        });
        records.push(record);
    }
    return records;
}

// Setup simulator controls for batch portfolio mode
function setupBatchSimulationEvents() {
    const btnIsolation = document.getElementById('batch-isolation-btn');
    const btnHeating = document.getElementById('batch-heating-btn');
    const btnReset = document.getElementById('batch-reset-btn');
    const btnExport = document.getElementById('batch-export-btn');

    btnIsolation.addEventListener('click', () => {
        batchRenovationState.isolation = !batchRenovationState.isolation;
        btnIsolation.classList.toggle('active', batchRenovationState.isolation);
        updatePortfolioAnalytics();
    });

    btnHeating.addEventListener('click', () => {
        batchRenovationState.heating = !batchRenovationState.heating;
        btnHeating.classList.toggle('active', batchRenovationState.heating);
        updatePortfolioAnalytics();
    });

    btnReset.addEventListener('click', () => {
        batchRenovationState.isolation = false;
        batchRenovationState.heating = false;
        btnIsolation.classList.remove('active');
        btnHeating.classList.remove('active');
        updatePortfolioAnalytics();
    });

    btnExport.addEventListener('click', exportPredictedPortfolioCSV);
}

// Compute DPE and batch metrics for the loaded portfolio
function updatePortfolioAnalytics() {
    if (importedBuildings.length === 0) return;

    let totalEnergyOriginal = 0;
    let totalEnergyRenovated = 0;
    let totalCo2Original = 0;
    let totalCo2Renovated = 0;
    let totalSurface = 0;

    const classCountsOriginal = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
    const classCountsRenovated = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };

    importedBuildings.forEach(b => {
        totalSurface += b.surface;
        totalEnergyOriginal += b.annualConsumption;

        // Calculate original CO2
        const originalCo2Factor = CO2_EMISSION_FACTORS[b.heatingType] || 0.06;
        totalCo2Original += b.annualConsumption * originalCo2Factor;

        // Compute original DPE
        const origPred = computeModelPrediction(b.surface, b.pieces, b.age, b.occupants, b.annualConsumption, b.heatingType, b.insulation);
        classCountsOriginal[origPred.predictedClass]++;
        b.originalDpe = origPred.predictedClass;
        b.originalConf = origPred.confidence;

        // Compute renovated DPE & Consumption
        const targetHeating = batchRenovationState.heating ? 'Pompe_a_chaleur' : b.heatingType;
        const targetInsulation = batchRenovationState.isolation ? 'Excellente' : b.insulation;
        
        const targetConsumption = calculateRenovatedConsumption(b.annualConsumption, b.heatingType, b.insulation, b.age, b.occupants, b.surface, batchRenovationState);
        totalEnergyRenovated += targetConsumption;

        // Calculate renovated CO2
        const renovatedCo2Factor = CO2_EMISSION_FACTORS[targetHeating] || 0.06;
        totalCo2Renovated += targetConsumption * renovatedCo2Factor;

        const renovPred = computeModelPrediction(b.surface, b.pieces, b.age, b.occupants, targetConsumption, targetHeating, targetInsulation);
        classCountsRenovated[renovPred.predictedClass]++;
        b.renovatedDpe = renovPred.predictedClass;
        b.renovatedConsumption = targetConsumption;
    });

    // Update KPI UI Elements
    document.getElementById('kpi-total-buildings').textContent = importedBuildings.length;
    
    const avgSpecific = (totalEnergyOriginal / totalSurface).toFixed(1);
    document.getElementById('kpi-avg-cons').textContent = `${avgSpecific} kWh/m²/an`;

    const savingsKwh = Math.max(0, totalEnergyOriginal - totalEnergyRenovated);
    document.getElementById('kpi-total-savings').textContent = `${savingsKwh.toLocaleString('fr-FR')} kWh/an`;

    // Update Simulation summary boxes
    const savingsBox = document.getElementById('batch-savings-box');
    if (batchRenovationState.isolation || batchRenovationState.heating) {
        savingsBox.style.display = 'block';
        document.getElementById('batch-savings-kwh').textContent = `-${savingsKwh.toLocaleString('fr-FR')} kWh / an`;
        
        const savingsEuros = Math.round(savingsKwh * 0.25); // ~0.25€ per kWh average
        document.getElementById('batch-savings-euros').innerHTML = `soit env. <strong>${savingsEuros.toLocaleString('fr-FR')} € / an</strong> d'économies cumulées`;
        
        const savingsCo2 = Math.max(0, (totalCo2Original - totalCo2Renovated) / 1000.0);
        document.getElementById('batch-savings-co2').innerHTML = `<i class="fa-solid fa-cloud-arrow-down"></i> Réduction CO₂ : <strong>${savingsCo2.toFixed(1)} tonnes / an</strong>`;
    } else {
        savingsBox.style.display = 'none';
    }

    // Render / Update Portfolio Chart
    renderPortfolioChart(classCountsOriginal, classCountsRenovated);

    // Populate Table
    renderPortfolioTable();
}

// Render double horizontal bar chart for DPE (Actual vs Renovated portfolio breakdown)
function renderPortfolioChart(originalCounts, renovatedCounts) {
    const ctx = document.getElementById('portfolio-chart').getContext('2d');
    const classes = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    
    const originalData = classes.map(c => originalCounts[c]);
    const renovatedData = classes.map(c => renovatedCounts[c]);

    const isRenovating = batchRenovationState.isolation || batchRenovationState.heating;

    if (portfolioChart) {
        // Update existing chart
        portfolioChart.data.datasets[0].data = originalData;
        portfolioChart.data.datasets[1].data = renovatedData;
        // Hide/show renovated dataset based on simulation activity
        portfolioChart.data.datasets[1].hidden = !isRenovating;
        portfolioChart.update();
        return;
    }

    portfolioChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: classes,
            datasets: [
                {
                    label: 'État Actuel',
                    data: originalData,
                    backgroundColor: '#0ea5e9',
                    borderRadius: 4,
                    barPercentage: isRenovating ? 0.75 : 0.6,
                    categoryPercentage: 0.8
                },
                {
                    label: 'Après Rénovation',
                    data: renovatedData,
                    backgroundColor: '#10b981',
                    borderRadius: 4,
                    barPercentage: 0.75,
                    categoryPercentage: 0.8,
                    hidden: !isRenovating
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    labels: { color: '#94a3b8', font: { family: 'Outfit', size: 12 } }
                },
                tooltip: { mode: 'index', intersect: false }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#f8fafc', font: { weight: 'bold' } }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8', stepSize: 1 }
                }
            }
        }
    });
}

// Populate the portfolio table with optional search filter
function renderPortfolioTable(filterText = '') {
    const tbody = document.getElementById('portfolio-table-body');
    tbody.innerHTML = '';
    
    const query = filterText.toLowerCase().trim();

    importedBuildings.forEach(b => {
        // Calculate specific consumption
        const specCons = (b.annualConsumption / b.surface).toFixed(1);
        
        // Match query
        const match = !query || 
            b.id.toString().includes(query) ||
            b.surface.toString().includes(query) ||
            b.heatingType.toLowerCase().includes(query) ||
            b.insulation.toLowerCase().includes(query) ||
            b.originalDpe.toLowerCase().includes(query) ||
            (b.renovatedDpe && b.renovatedDpe.toLowerCase().includes(query));

        if (!match) return;

        const row = document.createElement('tr');
        
        // Dynamic DPE color badge
        const dpeBadge = `<span class="table-dpe-badge dpe-${b.originalDpe.toLowerCase()}" style="background-color: ${DPE_CONFIG[b.originalDpe].color}; color: ${DPE_CONFIG[b.originalDpe].textColor}">${b.originalDpe}</span>`;
        
        // Show renovated DPE if simulation is active
        let dpeDisplay = dpeBadge;
        const isRenovating = batchRenovationState.isolation || batchRenovationState.heating;
        if (isRenovating && b.originalDpe !== b.renovatedDpe) {
            const renovBadge = `<span class="table-dpe-badge dpe-${b.renovatedDpe.toLowerCase()}" style="background-color: ${DPE_CONFIG[b.renovatedDpe].color}; color: ${DPE_CONFIG[b.renovatedDpe].textColor}">${b.renovatedDpe}</span>`;
            dpeDisplay = `${dpeBadge} <i class="fa-solid fa-right-long" style="margin: 0 4px; font-size: 0.75rem; color: #94a3b8;"></i> ${renovBadge}`;
        }

        // Show energy consumption adjustments
        let consDisplay = `${Math.round(b.annualConsumption).toLocaleString('fr-FR')} kWh`;
        let specDisplay = `${specCons}`;
        if (isRenovating && b.annualConsumption !== b.renovatedConsumption) {
            const renovatedSpec = (b.renovatedConsumption / b.surface).toFixed(1);
            consDisplay = `<span style="text-decoration: line-through; opacity: 0.5;">${Math.round(b.annualConsumption).toLocaleString('fr-FR')}</span><br><span style="color: #10b981; font-weight: 500;">${Math.round(b.renovatedConsumption).toLocaleString('fr-FR')} kWh</span>`;
            specDisplay = `<span style="text-decoration: line-through; opacity: 0.5;">${specCons}</span><br><span style="color: #10b981; font-weight: 500;">${renovatedSpec}</span>`;
        }

        row.innerHTML = `
            <td><strong>#${b.id}</strong></td>
            <td>${b.surface} m²</td>
            <td>${b.pieces}</td>
            <td>${Math.round(b.age)} ans</td>
            <td>${b.heatingType}</td>
            <td>${b.insulation}</td>
            <td>${consDisplay}</td>
            <td>${specDisplay} kWh/m²</td>
            <td>${dpeDisplay}</td>
            <td class="table-conf-display">${(b.originalConf * 100).toFixed(1)}%</td>
        `;
        tbody.appendChild(row);
    });

    if (tbody.children.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--text-muted); padding: 2rem;">Aucun bâtiment ne correspond au filtre de recherche.</td></tr>`;
    }
}

// Export predictions and simulation results back to a new CSV file
function exportPredictedPortfolioCSV() {
    if (importedBuildings.length === 0) return;

    // Headers
    let csvContent = "id,surface,pieces,age,occupants,annual_consumption,heating_type,insulation,predicted_energy_class,prediction_confidence,renovated_energy_class,renovated_consumption,energy_savings_kwh_year\n";

    importedBuildings.forEach(b => {
        const savings = Math.max(0, b.annualConsumption - b.renovatedConsumption);
        const row = [
            b.id,
            b.surface,
            b.pieces,
            b.age,
            b.occupants,
            b.annualConsumption,
            b.heatingType,
            b.insulation,
            b.originalDpe,
            b.originalConf.toFixed(4),
            b.renovatedDpe,
            b.renovatedConsumption,
            savings
        ];
        csvContent += row.join(',') + '\n';
    });

    // Create download element
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "dpe_predictions_rapport.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// -------------------------------------------------------------
// SUPABASE INTEGRATION & LOGGING
// -------------------------------------------------------------

// Debounce timeout for database writes
let logDebounceTimeout = null;

// Initialize Supabase Client from localStorage
function initSupabase() {
    const url = localStorage.getItem('supabase_url');
    const key = localStorage.getItem('supabase_key');
    const statusEl = document.getElementById('supabase-status');

    if (url && key) {
        try {
            if (window.supabase) {
                supabaseClient = window.supabase.createClient(url, key);
                statusEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> Connecté à Supabase`;
                statusEl.className = "connection-status status-success";
            } else {
                statusEl.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> SDK Supabase non chargé`;
                statusEl.className = "connection-status status-error";
            }
        } catch (err) {
            statusEl.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> Erreur d'initialisation`;
            statusEl.className = "connection-status status-error";
            console.error(err);
        }
    } else {
        supabaseClient = null;
        statusEl.innerHTML = `<i class="fa-solid fa-circle-question"></i> Non configuré`;
        statusEl.className = "connection-status status-unconfigured";
    }
}

// Bind modal open/close and submit events
function setupSupabaseUI() {
    const modal = document.getElementById('config-modal');
    const btnOpen = document.getElementById('btn-open-config');
    const btnClose = document.getElementById('btn-close-config');
    const btnSave = document.getElementById('btn-save-config');
    const btnClear = document.getElementById('btn-clear-config');
    
    const inputUrl = document.getElementById('sup-url');
    const inputKey = document.getElementById('sup-key');

    // Prepopulate inputs from localStorage
    if (inputUrl && inputKey) {
        inputUrl.value = localStorage.getItem('supabase_url') || '';
        inputKey.value = localStorage.getItem('supabase_key') || '';
    }

    if (btnOpen) {
        btnOpen.addEventListener('click', () => {
            modal.style.display = 'flex';
        });
    }

    if (btnClose) {
        btnClose.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }

    // Close when clicking outside the card
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    }

    if (btnSave) {
        btnSave.addEventListener('click', () => {
            const url = inputUrl.value.trim();
            const key = inputKey.value.trim();

            if (!url || !key) {
                alert("Veuillez renseigner l'URL et la clé API.");
                return;
            }

            localStorage.setItem('supabase_url', url);
            localStorage.setItem('supabase_key', key);
            
            initSupabase();
            modal.style.display = 'none';
        });
    }

    if (btnClear) {
        btnClear.addEventListener('click', () => {
            localStorage.removeItem('supabase_url');
            localStorage.removeItem('supabase_key');
            inputUrl.value = '';
            inputKey.value = '';
            
            initSupabase();
            modal.style.display = 'none';
        });
    }
}

// Debounced wrapper to avoid database spamming on slider movements
function logAuditToSupabaseDebounced(surface, pieces, age, occupants, consumption, heating, insulation, predictedClass, confidence) {
    if (logDebounceTimeout) clearTimeout(logDebounceTimeout);
    logDebounceTimeout = setTimeout(() => {
        logAuditToSupabase(surface, pieces, age, occupants, consumption, heating, insulation, predictedClass, confidence);
    }, 1500); // Wait 1.5 seconds after final slider movement
}

// Send diagnostic log entry to Supabase
async function logAuditToSupabase(surface, pieces, age, occupants, consumption, heating, insulation, predictedClass, confidence) {
    if (!supabaseClient) return;

    try {
        const { data, error } = await supabaseClient
            .from('audit_history')
            .insert([
                {
                    surface: surface,
                    pieces: pieces,
                    age: age,
                    occupants: occupants,
                    annual_consumption: consumption,
                    heating_type: heating,
                    insulation: insulation,
                    predicted_class: predictedClass,
                    confidence: confidence
                }
            ]);
            
        if (error) {
            console.warn("Erreur d'écriture Supabase :", error.message);
            const statusEl = document.getElementById('supabase-status');
            if (statusEl) {
                statusEl.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> Échec de l'enregistrement`;
                statusEl.className = "connection-status status-error";
            }
        } else {
            console.log("Diagnostic enregistré avec succès dans Supabase.");
            const statusEl = document.getElementById('supabase-status');
            if (statusEl) {
                statusEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> Connecté & Audit Enregistré`;
                statusEl.className = "connection-status status-success";
            }
            
            // Revert back status text after 3 seconds
            setTimeout(() => {
                if (supabaseClient) {
                    const statusEl = document.getElementById('supabase-status');
                    if (statusEl) {
                        statusEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> Connecté à Supabase`;
                        statusEl.className = "connection-status status-success";
                    }
                }
            }, 3000);
        }
    } catch (err) {
        console.error("Exception lors de l'appel Supabase :", err);
    }
}
