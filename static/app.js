/**
 * Yeast RNA-seq Analyzer Dashboard Logic
 */

// Global state variables
let gGenes = [];
let gIsReplicateMode = false;
let gSelectedGene = null;
let gActiveTab = 'upload-tab';
let gPathwayList = [];

// Base API URL (can be blank since we are hosting static files on same port)
const API_URL = "";

document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    initDropzone();
    initControls();
    
    // Add load mock button listener
    document.getElementById("load-mock-btn").addEventListener("click", loadMockData);
});

// ----------------------------------------------------------------------
// 1. Tab Navigation
// ----------------------------------------------------------------------
function initTabs() {
    const menuItems = document.querySelectorAll(".menu-item");
    menuItems.forEach(item => {
        item.addEventListener("click", (e) => {
            e.preventDefault();
            if (item.classList.contains("disabled")) return;
            
            const tabId = item.getAttribute("data-tab");
            switchTab(tabId);
        });
    });
}

function switchTab(tabId) {
    gActiveTab = tabId;
    
    // Update menu items active class
    const menuItems = document.querySelectorAll(".menu-item");
    menuItems.forEach(item => {
        if (item.getAttribute("data-tab") === tabId) {
            item.classList.add("active");
        } else {
            item.classList.remove("active");
        }
    });
    
    // Update tab panes visibility
    const panes = document.querySelectorAll(".tab-pane");
    panes.forEach(pane => {
        if (pane.id === tabId) {
            pane.classList.add("active");
        } else {
            pane.classList.remove("active");
        }
    });
    
    // Update Header Title based on Tab
    const titleEl = document.getElementById("page-title");
    const menuText = document.querySelector(`.menu-item[data-tab="${tabId}"] .menu-text`).textContent;
    titleEl.textContent = `S. cerevisiae RNA-seq - ${menuText}`;
    
    // Trigger chart redraws if necessary (Plotly sometimes needs to resize on tab show)
    if (tabId === 'volcano-tab') {
        renderVolcanoOrMAPlot();
    } else if (tabId === 'heatmap-tab') {
        renderHeatmap();
    } else if (tabId === 'pca-tab') {
        renderPCAPlot();
    } else if (tabId === 'network-tab') {
        renderNetworkGraph();
    } else if (tabId === 'gsea-tab') {
        loadGSEATerms();
    }
}

// Enable tabs after successful upload
function enableAnalysisTabs() {
    const disabledIds = ["nav-deg", "nav-volcano", "nav-pca", "nav-heatmap", "nav-kegg", "nav-go", "nav-network", "nav-gsea"];
    disabledIds.forEach(id => {
        document.getElementById(id).classList.remove("disabled");
    });
}

// ----------------------------------------------------------------------
// 2. File Upload & Mock Data
// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
// 2. File Upload & Mock Data
// ----------------------------------------------------------------------
let hotInstance = null;
let isFallbackGrid = false;

// Default Excel Grid sample data
const defaultGridData = [
    ["locus_tag", "Gene_Symbol", "WT_Rep1", "WT_Rep2", "WT_Rep3", "Mutant_Rep1", "Mutant_Rep2", "Mutant_Rep3"],
    ["YAL038W", "CDC19", "1200.5", "1150.2", "1250.8", "340.2", "320.5", "310.8"],
    ["YGR192C", "TDH3", "2400.1", "2450.4", "2390.9", "4500.8", "4600.2", "4450.5"],
    ["YFL039C", "ACT1", "850.3", "900.2", "870.5", "890.1", "860.4", "880.2"],
    ["YLR355C", "ILD1", "10.2", "12.5", "9.8", "120.5", "115.8", "130.2"],
    ["YDL215C", "GDH2", "50.5", "45.2", "55.8", "5.1", "4.8", "5.5"],
    ["YJR009C", "LUT2", "150.2", "160.5", "140.8", "850.3", "900.2", "870.5"],
    ["YKL060C", "FBA1", "300.5", "310.2", "290.8", "120.2", "130.5", "110.8"],
    ["YOL086C", "ADH1", "5000.5", "5100.2", "4900.8", "1500.2", "1600.5", "1400.8"]
];

// Fallback HTML table grid generator (for offline or loading failures)
function initFallbackGrid(gridEl) {
    isFallbackGrid = true;
    gridEl.innerHTML = "";
    gridEl.style.overflow = "auto";
    gridEl.style.height = "320px";
    
    const table = document.createElement("table");
    table.id = "fallback-html-table";
    table.className = "fallback-excel-table";
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";
    
    gridEl.appendChild(table);
    
    // Load default data
    loadFallbackData(defaultGridData);
    
    // Add paste event listener for Excel copy-paste compatibility
    table.addEventListener("paste", function(e) {
        e.preventDefault();
        const clipboardData = e.clipboardData || window.clipboardData;
        const pastedData = clipboardData.getData("Text");
        
        const rows = pastedData.split(/\r?\n/).map(row => row.split("\t"));
        if (rows.length === 0 || rows[0].length === 0) return;
        
        const activeCell = document.activeElement;
        if (!activeCell || activeCell.tagName !== "TD") return;
        
        const startRowIdx = activeCell.parentElement.rowIndex;
        const startColIdx = activeCell.cellIndex;
        
        const trs = table.rows;
        rows.forEach((rowData, rOffset) => {
            const targetRowIdx = startRowIdx + rOffset;
            
            while (targetRowIdx >= trs.length) {
                fallbackAddRow();
            }
            
            const tr = trs[targetRowIdx];
            rowData.forEach((val, cOffset) => {
                const targetColIdx = startColIdx + cOffset;
                
                while (targetColIdx >= tr.cells.length) {
                    fallbackAddCol();
                }
                
                tr.cells[targetColIdx].textContent = val;
            });
        });
    });
}

function loadFallbackData(dataArray) {
    const table = document.getElementById("fallback-html-table");
    if (!table) return;
    table.innerHTML = "";
    
    dataArray.forEach((rowData) => {
        const tr = document.createElement("tr");
        rowData.forEach((val) => {
            const td = document.createElement("td");
            td.contentEditable = "true";
            td.textContent = val;
            td.style.border = "1px solid #cbd5e1";
            td.style.padding = "6px 8px";
            td.style.minWidth = "80px";
            tr.appendChild(td);
        });
        table.appendChild(tr);
    });
    
    const currentRows = dataArray.length;
    const colCount = dataArray[0] ? dataArray[0].length : 8;
    for (let i = 0; i < (35 - currentRows); i++) {
        const tr = document.createElement("tr");
        for (let j = 0; j < colCount; j++) {
            const td = document.createElement("td");
            td.contentEditable = "true";
            td.style.border = "1px solid #cbd5e1";
            td.style.padding = "6px 8px";
            td.style.minWidth = "80px";
            tr.appendChild(td);
        }
        table.appendChild(tr);
    }
}

function fallbackAddRow() {
    const table = document.getElementById("fallback-html-table");
    if (!table) return;
    const colCount = table.rows[0] ? table.rows[0].cells.length : 8;
    const tr = document.createElement("tr");
    for (let i = 0; i < colCount; i++) {
        const td = document.createElement("td");
        td.contentEditable = "true";
        td.style.border = "1px solid #cbd5e1";
        td.style.padding = "6px 8px";
        td.style.minWidth = "80px";
        tr.appendChild(td);
    }
    table.appendChild(tr);
}

function fallbackAddCol() {
    const table = document.getElementById("fallback-html-table");
    if (!table) return;
    for (let i = 0; i < table.rows.length; i++) {
        const td = document.createElement("td");
        td.contentEditable = "true";
        td.style.border = "1px solid #cbd5e1";
        td.style.padding = "6px 8px";
        td.style.minWidth = "80px";
        table.rows[i].appendChild(td);
    }
}

// Automatically predict next column name (e.g. WT_Rep4) and insert new column
function addNewColumnAutomatically() {
    const addCount = parseInt(document.getElementById("grid-add-col-count").value, 10) || 1;
    let newColName = "New_Col";
    
    if (isFallbackGrid) {
        for (let c = 0; c < addCount; c++) {
            fallbackAddCol();
            const table = document.getElementById("fallback-html-table");
            if (table && table.rows[0]) {
                const currentCols = table.rows[0].cells.length;
                newColName = "Col_" + currentCols;
                const lastCell = table.rows[0].cells[currentCols - 1];
                lastCell.textContent = newColName;
            }
        }
    } else if (hotInstance) {
        try {
            const gridData = hotInstance.getData();
            if (!gridData || gridData.length === 0) return;
            
            const selected = hotInstance.getSelected();
            let colIdx = gridData[0].length - 1;
            if (selected && selected.length > 0) {
                colIdx = Math.max(selected[0][1], selected[0][3]);
            }
            
            // Loop for inserting specified number of columns
            for (let c = 0; c < addCount; c++) {
                const currentGridData = hotInstance.getData();
                const firstRow = currentGridData[0];
                let wtMax = 3;
                if (firstRow && firstRow.length > 0) {
                    firstRow.forEach(val => {
                        if (val && String(val).startsWith("WT_Rep")) {
                            const num = parseInt(String(val).replace("WT_Rep", ""), 10);
                            if (!isNaN(num) && num > wtMax) wtMax = num;
                        }
                    });
                }
                const genColName = "WT_Rep" + (wtMax + 1);
                
                // Splice new elements into grid row arrays
                currentGridData.forEach((row, index) => {
                    if (index === 0) {
                        row.splice(colIdx + 1 + c, 0, genColName);
                    } else {
                        row.splice(colIdx + 1 + c, 0, "");
                    }
                });
                
                hotInstance.loadData(currentGridData);
            }
        } catch (err) {
            console.error("Failed to add columns:", err);
            alert("열을 추가하는 도중 에러가 발생했습니다: " + err.message);
        }
    }
}

function fallbackDelRow() {
    const table = document.getElementById("fallback-html-table");
    if (!table) return;
    
    const activeCell = document.activeElement;
    if (activeCell && activeCell.tagName === "TD") {
        const rowIndex = activeCell.parentElement.rowIndex;
        if (table.rows.length > 1) {
            table.deleteRow(rowIndex);
        }
    } else {
        if (table.rows.length > 1) {
            table.deleteRow(table.rows.length - 1);
        }
    }
}

function fallbackDelCol() {
    const table = document.getElementById("fallback-html-table");
    if (!table) return;
    
    const activeCell = document.activeElement;
    let colIndex = -1;
    if (activeCell && activeCell.tagName === "TD") {
        colIndex = activeCell.cellIndex;
    } else {
        colIndex = table.rows[0] ? table.rows[0].cells.length - 1 : -1;
    }
    
    if (colIndex !== -1 && (table.rows[0] && table.rows[0].cells.length > 1)) {
        for (let i = 0; i < table.rows.length; i++) {
            table.rows[i].deleteCell(colIndex);
        }
    }
}

function getFallbackData() {
    const table = document.getElementById("fallback-html-table");
    if (!table) return [];
    
    const data = [];
    for (let i = 0; i < table.rows.length; i++) {
        const rowData = [];
        const cells = table.rows[i].cells;
        for (let j = 0; j < cells.length; j++) {
            rowData.push(cells[j].textContent);
        }
        data.push(rowData);
    }
    return data;
}

function initDropzone() {
    // 1. File Upload Elements
    const dropzone = document.getElementById("dropzone");
    const fileInput = document.getElementById("file-input");
    const fileInfo = document.getElementById("file-info");
    const selectedFileName = document.getElementById("selected-file-name");
    const analyzeBtn = document.getElementById("analyze-btn");
    
    // 2. Text Upload Elements
    const toggleFileUpload = document.getElementById("toggle-file-upload");
    const toggleTextUpload = document.getElementById("toggle-text-upload");
    const fileUploadContainer = document.getElementById("file-upload-container");
    const textUploadContainer = document.getElementById("text-upload-container");
    const analyzeTextBtn = document.getElementById("analyze-text-btn");
    
    // Initialize Handsontable or fallback HTML grid
    const gridEl = document.getElementById("excel-grid");
    if (gridEl) {
        if (typeof Handsontable !== "undefined") {
            try {
                // Prepare default data copy
                const sampleData = JSON.parse(JSON.stringify(defaultGridData));
                for (let i = 0; i < 30; i++) {
                    sampleData.push(["", "", "", "", "", "", "", ""]);
                }
                
                hotInstance = new Handsontable(gridEl, {
                    data: sampleData,
                    rowHeaders: true,
                    colHeaders: true,
                    contextMenu: true,
                    minSpareRows: 1,
                    stretchH: "all",
                    width: "100%",
                    height: "320px",
                    licenseKey: "non-commercial-and-evaluation"
                });
            } catch (e) {
                console.error("Handsontable initialization failed, loading fallback grid:", e);
                initFallbackGrid(gridEl);
            }
        } else {
            console.warn("Handsontable is not defined. Loading fallback HTML grid.");
            initFallbackGrid(gridEl);
        }
    }
    
    // Toggle UI logic
    toggleFileUpload.addEventListener("click", () => {
        toggleFileUpload.classList.add("active");
        toggleTextUpload.classList.remove("active");
        fileUploadContainer.style.display = "block";
        textUploadContainer.style.display = "none";
    });
    
    toggleTextUpload.addEventListener("click", () => {
        toggleTextUpload.classList.add("active");
        toggleFileUpload.classList.remove("active");
        textUploadContainer.style.display = "block";
        fileUploadContainer.style.display = "none";
        
        // Render/Resize grid
        if (isFallbackGrid) {
            // Nothing to do
        } else if (hotInstance) {
            setTimeout(() => {
                hotInstance.render();
            }, 50);
        }
    });
    
    // Grid Control Buttons Event Listeners
    document.getElementById("btn-grid-add-row").addEventListener("click", () => {
        const addCount = parseInt(document.getElementById("grid-add-row-count").value, 10) || 1;
        
        if (isFallbackGrid) {
            for (let r = 0; r < addCount; r++) {
                fallbackAddRow();
            }
        } else if (hotInstance) {
            try {
                const gridData = hotInstance.getData();
                if (!gridData || gridData.length === 0) return;
                
                const selected = hotInstance.getSelected();
                let rowIdx = gridData.length - 1;
                if (selected && selected.length > 0) {
                    rowIdx = Math.max(selected[0][0], selected[0][2]);
                }
                
                const colCount = gridData[0] ? gridData[0].length : 8;
                
                // Splice empty rows based on specified addCount
                for (let r = 0; r < addCount; r++) {
                    const newRow = Array(colCount).fill("");
                    gridData.splice(rowIdx + 1 + r, 0, newRow);
                }
                
                hotInstance.loadData(gridData);
            } catch (err) {
                console.error("Failed to add rows:", err);
            }
        }
    });

    document.getElementById("btn-grid-del-row").addEventListener("click", () => {
        if (isFallbackGrid) {
            fallbackDelRow();
        } else if (hotInstance) {
            try {
                const gridData = hotInstance.getData();
                if (!gridData || gridData.length <= 1) return;
                
                const selected = hotInstance.getSelected();
                if (selected && selected.length > 0) {
                    const startRow = Math.min(selected[0][0], selected[0][2]);
                    const endRow = Math.max(selected[0][0], selected[0][2]);
                    const count = endRow - startRow + 1;
                    gridData.splice(startRow, count);
                } else {
                    gridData.pop();
                }
                hotInstance.loadData(gridData);
            } catch (err) {
                console.error("Failed to delete row:", err);
            }
        }
    });

    document.getElementById("btn-grid-add-col").addEventListener("click", () => {
        addNewColumnAutomatically();
    });

    document.getElementById("btn-grid-del-col").addEventListener("click", () => {
        if (isFallbackGrid) {
            fallbackDelCol();
        } else if (hotInstance) {
            try {
                const gridData = hotInstance.getData();
                if (!gridData || gridData.length === 0) return;
                
                const selected = hotInstance.getSelected();
                let colIdx = (gridData[0] ? gridData[0].length : 8) - 1;
                let count = 1;
                if (selected && selected.length > 0) {
                    colIdx = Math.min(selected[0][1], selected[0][3]);
                    const endCol = Math.max(selected[0][1], selected[0][3]);
                    count = endCol - colIdx + 1;
                }
                
                // Ensure we don't delete all columns
                if (gridData[0].length > count) {
                    gridData.forEach(row => {
                        row.splice(colIdx, count);
                    });
                    hotInstance.loadData(gridData);
                }
            } catch (err) {
                console.error("Failed to delete column:", err);
            }
        }
    });

    document.getElementById("btn-grid-clear").addEventListener("click", () => {
        const headerRow = ["locus_tag", "Gene_Symbol", "WT_Rep1", "WT_Rep2", "WT_Rep3", "Mutant_Rep1", "Mutant_Rep2", "Mutant_Rep3"];
        const emptyData = [headerRow];
        for (let i = 0; i < 30; i++) {
            emptyData.push(["", "", "", "", "", "", "", ""]);
        }
        
        if (isFallbackGrid) {
            loadFallbackData(emptyData);
        } else if (hotInstance) {
            hotInstance.loadData(emptyData);
        }
    });

    document.getElementById("btn-grid-sample").addEventListener("click", () => {
        const sampleData = JSON.parse(JSON.stringify(defaultGridData));
        if (isFallbackGrid) {
            loadFallbackData(sampleData);
        } else if (hotInstance) {
            hotInstance.loadData(sampleData);
        }
    });
    
    // Trigger input click on dropzone click
    dropzone.addEventListener("click", () => fileInput.click());
    
    // Drag and drop classes
    dropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropzone.classList.add("dragover");
    });
    
    ["dragleave", "drop"].forEach(eventName => {
        dropzone.addEventListener(eventName, () => {
            dropzone.classList.remove("dragover");
        });
    });
    
    dropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) {
            fileInput.files = e.dataTransfer.files;
            handleFileSelect(fileInput.files[0]);
        }
    });
    
    fileInput.addEventListener("change", () => {
        if (fileInput.files.length) {
            handleFileSelect(fileInput.files[0]);
        }
    });
    
    function handleFileSelect(file) {
        selectedFileName.textContent = file.name;
        fileInfo.style.display = "flex";
    }
    
    analyzeBtn.addEventListener("click", () => {
        const file = fileInput.files[0];
        if (!file) return;
        
        uploadFile(file);
    });
    
    // Grid data submission and TSV parsing trigger
    analyzeTextBtn.addEventListener("click", () => {
        const gridData = isFallbackGrid ? getFallbackData() : (hotInstance ? hotInstance.getData() : []);
        const tsvRows = [];

        gridData.forEach((row) => {
            const hasContent = row.some(cell => cell !== null && String(cell).trim() !== "");
            if (hasContent) {
                const cleanRow = row.map(cell => {
                    if (cell === null || cell === undefined) return "";
                    return String(cell).replace(/[\t\r\n]/g, " ");
                });
                tsvRows.push(cleanRow.join("\t"));
            }
        });

        if (tsvRows.length < 2) {
            alert("그리드에 데이터를 입력해 주세요. 최소한 헤더 행과 1개 이상의 데이터 행이 필요합니다.");
            return;
        }

        const tsvText = tsvRows.join("\n");
        uploadText(tsvText);
    });
}

function updateStatus(state, text) {
    const badge = document.getElementById("status-badge");
    badge.className = `status-indicator ${state}`;
    badge.querySelector(".status-text").textContent = text;
}

function uploadFile(file) {
    updateStatus("analyzing", "데이터 분석 중...");
    
    const formData = new FormData();
    formData.append("file", file);
    
    fetch(`${API_URL}/api/upload`, {
        method: "POST",
        body: formData
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(err => { throw new Error(err.detail || "파일 파싱 실패") });
        }
        return response.json();
    })
    .then(data => {
        processUploadedData(data);
    })
    .catch(err => {
        alert(`에러: ${err.message}`);
        updateStatus("ready", "대기 중");
    });
}

function uploadText(text) {
    updateStatus("analyzing", "데이터 분석 중...");
    
    fetch(`${API_URL}/api/upload_text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text })
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(err => { throw new Error(err.detail || "텍스트 파싱 실패") });
        }
        return response.json();
    })
    .then(data => {
        processUploadedData(data);
    })
    .catch(err => {
        alert(`에러: ${err.message}`);
        updateStatus("ready", "대기 중");
    });
}

function loadMockData() {
    updateStatus("analyzing", "Mock 데이터 생성 및 로드 중...");
    
    // Fetch all genes to see if Mock file was generated
    fetch(`${API_URL}/api/genes`)
        .then(r => r.json())
        .then(data => {
            if (data.genes && data.genes.length > 0) {
                // Already generated and loaded, we can use it
                gGenes = data.genes;
                // Detect mode
                gIsReplicateMode = gGenes[0].hasOwnProperty("fdr") && gGenes[0].fdr !== null;
                finalizeDataLoading();
            } else {
                // If not, it means we should call mock endpoint or notify user.
                // In our implementation, we generated the mock file earlier via generate_mock_data.py.
                // We will upload that mock file!
                // Wait, we can fetch the local server's copy of mock or simulate a upload of the generated mock.
                // Since the file is on the server at "mock_yeast_rnaseq.xlsx", the backend doesn't have a direct load mock endpoint, but we can write a quick upload mockup or fetch.
                // Let's create a quick API trigger on the server, or we can just download the generated excel file in the frontend using standard fetch, and then upload it back!
                // That is extremely clever and uses existing upload endpoint!
                fetch("/mock_yeast_rnaseq.xlsx")
                    .then(res => {
                        if (!res.ok) throw new Error("Mock file not found on server.");
                        return res.blob();
                    })
                    .then(blob => {
                        const file = new File([blob], "mock_yeast_rnaseq.xlsx", {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
                        uploadFile(file);
                    })
                    .catch(err => {
                        alert("Mock 엑셀 파일을 가져오지 못했습니다. 서버 터미널에서 `python generate_mock_data.py`가 성공했는지 확인해주세요.");
                        updateStatus("ready", "대기 중");
                    });
            }
        });
}

function processUploadedData(data) {
    gGenes = data.genes;
    gIsReplicateMode = data.is_replicate_mode;
    
    // Fetch all genes to get full dataset
    fetch(`${API_URL}/api/genes`)
        .then(r => r.json())
        .then(fullData => {
            gGenes = fullData.genes;
            finalizeDataLoading();
        });
}

function finalizeDataLoading() {
    updateStatus("ready", "분석 완료");
    enableAnalysisTabs();
    
    // Configure p-value filters visibility based on mode
    const pvalFilterGroup = document.getElementById("pvalue-filter-group");
    const heatmapMetricPvalue = document.getElementById("heatmap-metric-pvalue");
    const statType = document.getElementById("stat-type").value;
    const pvalInput = document.getElementById("pvalue-thresh");
    
    if (gIsReplicateMode) {
        pvalFilterGroup.style.display = "flex";
        if (statType === "none") {
            pvalInput.disabled = true;
            pvalInput.style.opacity = "0.5";
        } else {
            pvalInput.disabled = false;
            pvalInput.style.opacity = "1.0";
        }
        heatmapMetricPvalue.disabled = false;
        document.getElementById("plot-title-text").textContent = "Volcano Plot";
        document.getElementById("plot-toggle-btns").style.display = "flex";
    } else {
        pvalFilterGroup.style.display = "none";
        heatmapMetricPvalue.disabled = true;
        document.getElementById("heatmap-metric").value = "log2fc"; // Fallback metric
        document.getElementById("plot-title-text").textContent = "MA Plot";
        document.getElementById("plot-toggle-btns").style.display = "none";
    }
    
    // Populate DEG Table
    renderDEGTable();
    
    // Fetch KEGG pathways list
    fetchKEGGPathways();
    
    // Automatically switch to DEG view
    switchTab("deg-tab");
}

// ----------------------------------------------------------------------
// 3. DEG Table View
// ----------------------------------------------------------------------
function initControls() {
    const controls = ["log2fc-thresh", "pvalue-thresh", "search-gene"];
    controls.forEach(id => {
        document.getElementById(id).addEventListener("input", () => {
            renderDEGTable();
            renderVolcanoOrMAPlot();
        });
    });
    
    // Statistical significance criteria toggle
    document.getElementById("stat-type").addEventListener("change", () => {
        const statType = document.getElementById("stat-type").value;
        const pvalInput = document.getElementById("pvalue-thresh");
        if (statType === "none") {
            pvalInput.disabled = true;
            pvalInput.style.opacity = "0.5";
        } else {
            pvalInput.disabled = false;
            pvalInput.style.opacity = "1.0";
        }
        renderDEGTable();
        renderVolcanoOrMAPlot();
    });
    
    // Heatmap controls
    document.getElementById("regenerate-heatmap").addEventListener("click", renderHeatmap);
    
    // GO Enrichment
    document.getElementById("run-go-btn").addEventListener("click", runGOEnrichment);
    
    // STRING Network Rebuild
    document.getElementById("btn-rebuild-network").addEventListener("click", renderNetworkGraph);
    
    // Volcano Toggle buttons
    document.getElementById("btn-show-volcano").addEventListener("click", () => {
        document.getElementById("btn-show-volcano").classList.add("active");
        document.getElementById("btn-show-ma").classList.remove("active");
        renderPlot("volcano");
    });
    
    document.getElementById("btn-show-ma").addEventListener("click", () => {
        document.getElementById("btn-show-ma").classList.add("active");
        document.getElementById("btn-show-volcano").classList.remove("active");
        renderPlot("ma");
    });
}

function renderDEGTable() {
    const log2fcThresh = parseFloat(document.getElementById("log2fc-thresh").value) || 0;
    const pvalThresh = parseFloat(document.getElementById("pvalue-thresh").value) || 1.0;
    const searchVal = document.getElementById("search-gene").value.toLowerCase();
    
    const tbody = document.getElementById("deg-table-body");
    tbody.innerHTML = "";
    
    let upCount = 0;
    let downCount = 0;
    let filteredCount = 0;
    
    gGenes.forEach(gene => {
        const symbol = gene.gene_symbol.toLowerCase();
        const locus = gene.locus_tag.toLowerCase();
        
        // Search filter
        if (searchVal && !symbol.includes(searchVal) && !locus.includes(searchVal)) {
            return;
        }
        
        // Determine DEG classification
        let classification = "Neutral";
        let classClass = "";
        
        const statType = document.getElementById("stat-type") ? document.getElementById("stat-type").value : "fdr";
        const statVal = statType === "fdr" ? gene.fdr : gene.pvalue;
        
        const passesLog2FC = Math.abs(gene.log2fc) >= log2fcThresh;
        let passesPVal = true;
        if (statType !== "none" && gIsReplicateMode) {
            passesPVal = (statVal !== null && statVal <= pvalThresh);
        }
        
        if (passesLog2FC && passesPVal) {
            if (gene.log2fc >= log2fcThresh) {
                classification = "Upregulated";
                classClass = "up-text";
                upCount++;
            } else if (gene.log2fc <= -log2fcThresh) {
                classification = "Downregulated";
                classClass = "down-text";
                downCount++;
            }
        }
        
        filteredCount++;
        
        // Append row
        const row = document.createElement("tr");
        if (gSelectedGene && gSelectedGene.locus_tag === gene.locus_tag) {
            row.classList.add("selected");
        }
        
        row.innerHTML = `
            <td><code>${gene.locus_tag}</code></td>
            <td><strong>${gene.gene_symbol}</strong></td>
            <td>${gene.wt_val}</td>
            <td>${gene.mutant_val}</td>
            <td class="${gene.log2fc >= 0 ? 'up-text' : 'down-text'}">${gene.log2fc > 0 ? '+' : ''}${gene.log2fc}</td>
            <td>${gene.pvalue !== null ? gene.pvalue : '-'}</td>
            <td>${gene.fdr !== null ? gene.fdr : '-'}</td>
            <td class="${classClass}">${classification}</td>
            <td class="text-muted" title="${gene.description}">${gene.description.length > 50 ? gene.description.substring(0, 50) + "..." : gene.description}</td>
        `;
        
        row.addEventListener("click", () => {
            // Highlight row
            document.querySelectorAll("#deg-table tr").forEach(r => r.classList.remove("selected"));
            row.classList.add("selected");
            
            // Show detail panel
            showGeneDetails(gene);
        });
        
        tbody.appendChild(row);
    });
    
    // Update badges
    document.getElementById("stat-up-count").textContent = upCount;
    document.getElementById("stat-down-count").textContent = downCount;
    document.getElementById("stat-total-count").textContent = gGenes.length;
}

// ----------------------------------------------------------------------
// 4. Volcano / MA Plot Redrawing
// ----------------------------------------------------------------------
function renderVolcanoOrMAPlot() {
    const showVolcano = gIsReplicateMode && document.getElementById("btn-show-volcano").classList.contains("active");
    renderPlot(showVolcano ? "volcano" : "ma");
}

function renderPlot(plotType) {
    const log2fcThresh = parseFloat(document.getElementById("log2fc-thresh").value) || 0;
    const pvalThresh = parseFloat(document.getElementById("pvalue-thresh").value) || 1.0;
    const statType = document.getElementById("stat-type") ? document.getElementById("stat-type").value : "fdr";
    
    const xData = [];
    const yData = [];
    const textData = [];
    const colorData = [];
    const customData = [];
    
    gGenes.forEach(gene => {
        const statVal = statType === "fdr" ? gene.fdr : gene.pvalue;
        let passesPVal = true;
        if (statType !== "none" && gIsReplicateMode) {
            passesPVal = (statVal !== null && statVal <= pvalThresh);
        }
        const isUp = gene.log2fc >= log2fcThresh && passesPVal;
        const isDown = gene.log2fc <= -log2fcThresh && passesPVal;
        
        let color = '#64748b'; // Neutral (Grey)
        if (isUp) color = '#ff4d4d'; // Upregulated (Red)
        if (isDown) color = '#4d4dff'; // Downregulated (Blue)
        
        if (plotType === "volcano") {
            xData.push(gene.log2fc);
            // Y-axis: if statType is none, default to using FDR to draw Volcano shape
            const yStatVal = statType === "none" ? gene.fdr : statVal;
            const yVal = (yStatVal !== null && yStatVal > 0) ? -Math.log10(yStatVal) : 0;
            yData.push(yVal);
        } else {
            // MA Plot: X-axis is log2 Mean Expression, Y-axis is Log2FC
            const meanExpr = (gene.wt_val + gene.mutant_val) / 2;
            const xVal = meanExpr > 0 ? Math.log2(meanExpr) : 0;
            xData.push(xVal);
            yData.push(gene.log2fc);
        }
        
        const statLabel = statType === "fdr" ? "FDR" : "p-value";
        textData.push(`${gene.gene_symbol} (${gene.locus_tag})<br>Log2FC: ${gene.log2fc}<br>${statLabel}: ${statVal !== null ? statVal : '-'}`);
        colorData.push(color);
        customData.push(gene);
    });
    
    const trace = {
        x: xData,
        y: yData,
        mode: 'markers',
        type: 'scatter',
        text: textData,
        marker: {
            size: 8,
            color: colorData,
            opacity: 0.8,
            line: {
                color: 'rgba(0,0,0,0.2)',
                width: 0.5
            }
        },
        customdata: customData
    };
    
    const layout = {
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: {
            color: '#0f172a',
            family: 'Inter, sans-serif'
        },
        xaxis: {
            title: plotType === "volcano" ? 'Log2 Fold Change' : 'Log2 Mean Expression (TPM)',
            gridcolor: '#e2e8f0',
            zerolinecolor: '#cbd5e1'
        },
        yaxis: {
            title: plotType === "volcano" ? (statType === "fdr" || statType === "none" ? '-Log10(FDR)' : '-Log10(p-value)') : 'Log2 Fold Change',
            gridcolor: '#e2e8f0',
            zerolinecolor: '#cbd5e1'
        },
        margin: { t: 20, r: 20, b: 50, l: 60 },
        hovermode: 'closest',
        shapes: []
    };
    
    // Add thresh lines
    if (plotType === "volcano") {
        layout.shapes.push(
            // Vertical -thresh line
            {
                type: 'line',
                x0: -log2fcThresh, x1: -log2fcThresh,
                y0: 0, y1: Math.max(...yData) * 1.05,
                line: { color: 'rgba(15, 23, 42, 0.25)', width: 1, dash: 'dash' }
            },
            // Vertical +thresh line
            {
                type: 'line',
                x0: log2fcThresh, x1: log2fcThresh,
                y0: 0, y1: Math.max(...yData) * 1.05,
                line: { color: 'rgba(15, 23, 42, 0.25)', width: 1, dash: 'dash' }
            }
        );
        if (gIsReplicateMode && statType !== "none" && pvalThresh < 1.0) {
            const hVal = -Math.log10(pvalThresh);
            layout.shapes.push(
                // Horizontal FDR line
                {
                    type: 'line',
                    x0: Math.min(...xData) * 1.05, x1: Math.max(...xData) * 1.05,
                    y0: hVal, y1: hVal,
                    line: { color: 'rgba(15, 23, 42, 0.25)', width: 1, dash: 'dash' }
                }
            );
        }
    } else {
        // MA Plot thresholds
        layout.shapes.push(
            {
                type: 'line',
                x0: 0, x1: Math.max(...xData) * 1.05,
                y0: log2fcThresh, y1: log2fcThresh,
                line: { color: 'rgba(15, 23, 42, 0.25)', width: 1, dash: 'dash' }
            },
            {
                type: 'line',
                x0: 0, x1: Math.max(...xData) * 1.05,
                y0: -log2fcThresh, y1: -log2fcThresh,
                line: { color: 'rgba(15, 23, 42, 0.25)', width: 1, dash: 'dash' }
            }
        );
    }
    
    Plotly.newPlot('plotly-chart', [trace], layout, {responsive: true});
    
    // Register click event
    const plotEl = document.getElementById('plotly-chart');
    plotEl.on('plotly_click', (data) => {
        if (data.points && data.points[0]) {
            const gene = data.points[0].customdata;
            showGeneDetails(gene);
        }
    });
}

// ----------------------------------------------------------------------
// 5. Gene Detail Panel
// ----------------------------------------------------------------------
function showGeneDetails(gene) {
    gSelectedGene = gene;
    
    const panel = document.getElementById("gene-detail-body");
    panel.innerHTML = `
        <div class="gene-detail-card">
            <div class="gene-detail-header">
                <span class="gene-detail-title">${gene.gene_symbol}</span>
                <span class="gene-detail-locus">${gene.locus_tag}</span>
            </div>
            <p class="gene-detail-desc">${gene.description || '유전자 설명이 존재하지 않습니다.'}</p>
            
            <div class="gene-detail-grid">
                <div class="detail-item">
                    <span class="detail-lbl">WT 평균 발현량</span>
                    <span class="detail-val">${gene.wt_val}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-lbl">Mutant 평균 발현량</span>
                    <span class="detail-val">${gene.mutant_val}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-lbl">Log2 Fold Change</span>
                    <span class="detail-val ${gene.log2fc >= 0 ? 'up-text' : 'down-text'}">${gene.log2fc}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-lbl">FDR (Adjusted P-val)</span>
                    <span class="detail-val">${gene.fdr !== null ? gene.fdr : '-'}</span>
                </div>
            </div>
            
            <div id="plotly-bar-detail" style="height: 250px; width: 100%;"></div>
        </div>
    `;
    
    // Render detail WT vs Mutant bar chart
    renderDetailChart(gene);
    
    // If we clicked from DEG table, we should also navigate to Volcano tab to show the detail side panel
    if (gActiveTab !== 'volcano-tab') {
        switchTab('volcano-tab');
    }
}

function renderDetailChart(gene) {
    let trace1, trace2;
    
    if (gIsReplicateMode && gene.wt_reps && gene.mut_reps) {
        // Show replicates as bar + scatter points
        trace1 = {
            x: ['WT', 'Mutant'],
            y: [gene.wt_val, gene.mutant_val],
            type: 'bar',
            name: '평균값',
            marker: { color: ['rgba(59, 130, 246, 0.4)', 'rgba(239, 68, 68, 0.4)'] }
        };
        
        // Replicate dots
        const repX = [];
        const repY = [];
        gene.wt_reps.forEach(v => { repX.push('WT'); repY.push(v); });
        gene.mut_reps.forEach(v => { repX.push('Mutant'); repY.push(v); });
        
        trace2 = {
            x: repX,
            y: repY,
            mode: 'markers',
            type: 'scatter',
            name: '반복구',
            marker: { size: 10, color: ['#3b82f6', '#3b82f6', '#3b82f6', '#ff4d4d', '#ff4d4d', '#ff4d4d'], opacity: 0.9 }
        };
    } else {
        // Average mode, show simple bar
        trace1 = {
            x: ['WT', 'Mutant'],
            y: [gene.wt_val, gene.mutant_val],
            type: 'bar',
            marker: { color: ['#3b82f6', '#ff4d4d'] }
        };
    }
    
    const layout = {
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: {
            color: '#0f172a',
            family: 'Inter, sans-serif'
        },
        xaxis: {
            gridcolor: '#e2e8f0'
        },
        yaxis: {
            title: 'Expression (TPM/FPKM)',
            gridcolor: '#e2e8f0'
        },
        margin: { t: 20, r: 10, b: 30, l: 50 },
        showlegend: false
    };
    
    const data = trace2 ? [trace1, trace2] : [trace1];
    Plotly.newPlot('plotly-bar-detail', data, layout, {responsive: true});
}

// ----------------------------------------------------------------------
// 6. Heatmap View
// ----------------------------------------------------------------------
function renderHeatmap() {
    if (gGenes.length === 0) return;
    
    const count = parseInt(document.getElementById("heatmap-count").value);
    const metric = document.getElementById("heatmap-metric").value;
    const applyClustering = document.getElementById("heatmap-cluster").checked;
    
    // Sort genes to find top DEGs
    let sorted = [...gGenes];
    if (metric === "log2fc") {
        sorted.sort((a, b) => Math.abs(b.log2fc) - Math.abs(a.log2fc));
    } else {
        // Sort by lowest FDR/pvalue (exclude nulls)
        sorted = sorted.filter(g => g.fdr !== null);
        sorted.sort((a, b) => a.fdr - b.fdr);
    }
    
    const topGenes = sorted.slice(0, count);
    
    // Extract matrix and Z-score normalize row-wise
    const yLabels = [];
    const zDataWT = [];
    const zDataMutant = [];
    
    topGenes.forEach(gene => {
        yLabels.push(`${gene.gene_symbol} (${gene.locus_tag})`);
        
        let wtVals = [gene.wt_val];
        let mutVals = [gene.mutant_val];
        if (gIsReplicateMode && gene.wt_reps && gene.mut_reps) {
            wtVals = gene.wt_reps;
            mutVals = gene.mut_reps;
        }
        
        // Z-score calculation
        const allVals = [...wtVals, ...mutVals];
        const mean = npMean(allVals);
        const std = npStd(allVals) || 1.0;
        
        zDataWT.push(wtVals.map(v => (v - mean) / std));
        zDataMutant.push(mutVals.map(v => (v - mean) / std));
    });
    
    // Assemble samples columns labels
    const xLabels = [];
    const zDataMatrix = [];
    
    let wtCount = zDataWT[0].length;
    let mutCount = zDataMutant[0].length;
    
    for (let i = 0; i < wtCount; i++) {
        xLabels.push(wtCount > 1 ? `WT_Rep${i+1}` : 'WT');
    }
    for (let i = 0; i < mutCount; i++) {
        xLabels.push(mutCount > 1 ? `Mutant_Rep${i+1}` : 'Mutant');
    }
    
    // Combine matrix
    for (let r = 0; r < yLabels.length; r++) {
        zDataMatrix.push([...zDataWT[r], ...zDataMutant[r]]);
    }
    
    // Simple mock hierarchical clustering for layout (optional, just sort by overall FC for visual neatness if cluster unchecked)
    if (!applyClustering) {
        // Already sorted by metric
    } else {
        // Let's sort rows based on their WT vs Mutant difference (which serves as a clean 1D clustering effect)
        const rowScores = topGenes.map((g, idx) => ({index: idx, score: g.log2fc}));
        rowScores.sort((a, b) => b.score - a.score);
        
        const sortedMatrix = [];
        const sortedYLabels = [];
        rowScores.forEach(item => {
            sortedMatrix.push(zDataMatrix[item.index]);
            sortedYLabels.push(yLabels[item.index]);
        });
        
        // Overwrite
        zDataMatrix.length = 0;
        zDataMatrix.push(...sortedMatrix);
        yLabels.length = 0;
        yLabels.push(...sortedYLabels);
    }
    
    // Create Plotly Heatmap
    const trace = {
        z: zDataMatrix,
        x: xLabels,
        y: yLabels,
        type: 'heatmap',
        colorscale: [
            [0, '#0000ff'],      // Deep Blue (Downregulated)
            [0.5, '#ffffff'],    // White (Mean)
            [1, '#ff0000']       // Deep Red (Upregulated)
        ],
        colorbar: {
            title: 'Z-score',
            titleside: 'right'
        },
        hoverongaps: false
    };
    
    const layout = {
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: {
            color: '#0f172a',
            family: 'Inter, sans-serif'
        },
        margin: { t: 20, r: 20, b: 60, l: 150 },
        xaxis: {
            tickangle: -45
        },
        yaxis: {
            autorange: 'reversed',
            showgrid: false
        }
    };
    
    Plotly.newPlot('plotly-heatmap', [trace], layout, {responsive: true});
}

// Simple stats helpers in JS
function npMean(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function npStd(arr) {
    const mean = npMean(arr);
    const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
    return Math.sqrt(variance);
}

// ----------------------------------------------------------------------
// 7. KEGG Pathway View
// ----------------------------------------------------------------------
function fetchKEGGPathways() {
    const listEl = document.getElementById("kegg-pathway-list");
    listEl.innerHTML = '<li class="loading-item">KEGG Yeast 경로 목록을 가져오고 있습니다...</li>';
    
    fetch(`${API_URL}/api/pathways`)
        .then(r => r.json())
        .then(data => {
            gPathwayList = data.pathways;
            listEl.innerHTML = "";
            
            if (gPathwayList.length === 0) {
                listEl.innerHTML = '<li class="loading-item text-muted">경로 데이터가 없습니다.</li>';
                return;
            }
            
            gPathwayList.forEach(path => {
                const li = document.createElement("li");
                li.innerHTML = `
                    <div class="kegg-path-desc" title="${path.description}">
                        <span class="kegg-path-id">${path.pathway_id}</span>
                        ${path.description}
                    </div>
                    <span class="kegg-gene-count-badge">${path.gene_count} 유전자 매핑</span>
                `;
                
                li.addEventListener("click", () => {
                    document.querySelectorAll("#kegg-pathway-list li").forEach(el => el.classList.remove("active"));
                    li.classList.add("active");
                    
                    loadPathwayMap(path);
                });
                
                listEl.appendChild(li);
            });
        })
        .catch(err => {
            listEl.innerHTML = `<li class="loading-item text-danger">실패: ${err.message}</li>`;
        });
}

function loadPathwayMap(path) {
    const container = document.getElementById("kegg-map-container");
    container.innerHTML = `
        <div class="no-pathway-selected">
            <i class="fa-solid fa-circle-notch fa-spin map-big-icon"></i>
            <p>KEGG 서버로부터 색상 맵핑 지도 생성 중...</p>
            <p class="sub-hint">대사 경로 상의 유전자 발현량에 따라 색칠된 원본 지도를 가져오고 있습니다.</p>
        </div>
    `;
    
    document.getElementById("kegg-map-title").textContent = `KEGG: ${path.description} (${path.pathway_id})`;
    
    fetch(`${API_URL}/api/pathway_map/${path.pathway_id}`)
        .then(response => {
            if (!response.ok) {
                throw new Error("KEGG 연동에 실패했습니다. (네트워크 연결 혹은 KEGG API 한계 도달)");
            }
            return response.json();
        })
        .then(data => {
            renderPathwayImageViewer(data);
        })
        .catch(err => {
            container.innerHTML = `
                <div class="no-pathway-selected text-danger">
                    <i class="fa-solid fa-triangle-exclamation map-big-icon"></i>
                    <p>KEGG 지도 로드 실패</p>
                    <p class="sub-hint">${err.message}</p>
                </div>
            `;
        });
}

function getGeneColor(log2fc) {
    if (log2fc === null || log2fc === undefined) return null;
    
    if (log2fc > 0) {
        const ratio = Math.min(log2fc / 2.5, 1.0);
        // Semi-transparent Red (Up-regulated)
        return `rgba(239, 68, 68, ${0.4 + ratio * 0.45})`;
    } else {
        const ratio = Math.min(Math.abs(log2fc) / 2.5, 1.0);
        // Semi-transparent Blue (Down-regulated)
        return `rgba(59, 130, 246, ${0.4 + ratio * 0.45})`;
    }
}

function renderPathwayImageViewer(data) {
    const container = document.getElementById("kegg-map-container");
    container.innerHTML = "";
    
    // Create wrapper
    const wrapper = document.createElement("div");
    wrapper.className = "kegg-image-wrapper";
    
    // Create image
    const img = document.createElement("img");
    img.src = data.image;
    img.useMap = "#keggmap_client";
    wrapper.appendChild(img);
    
    // Create Map
    const map = document.createElement("map");
    map.name = "keggmap_client";
    map.id = "keggmap_client";
    
    // Create custom tooltip element
    let tooltip = document.getElementById("kegg-active-tooltip");
    if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.id = "kegg-active-tooltip";
        tooltip.className = "kegg-tooltip";
        document.body.appendChild(tooltip);
    }
    
    data.areas.forEach(area => {
        const areaEl = document.createElement("area");
        areaEl.shape = area.shape;
        areaEl.coords = area.coords;
        areaEl.alt = area.title;
        areaEl.href = "#"; // Prevent navigation
        
        // If it's a rect gene node and has log2fc, draw a styled colored overlay box
        if (area.shape === "rect" && area.log2fc !== null) {
            const coordsArr = area.coords.split(",").map(Number);
            if (coordsArr.length === 4) {
                const [x1, y1, x2, y2] = coordsArr;
                const overlay = document.createElement("div");
                overlay.className = "kegg-node-overlay";
                overlay.style.position = "absolute";
                overlay.style.left = `${x1}px`;
                overlay.style.top = `${y1}px`;
                overlay.style.width = `${x2 - x1}px`;
                overlay.style.height = `${y2 - y1}px`;
                overlay.style.backgroundColor = getGeneColor(area.log2fc);
                overlay.style.border = "1.5px solid rgba(0, 0, 0, 0.4)";
                overlay.style.borderRadius = "2px";
                overlay.style.pointerEvents = "none"; // Let mouse events pass through to <area>
                overlay.style.boxSizing = "border-box";
                overlay.title = `${area.title} (Log2FC: ${area.log2fc})`;
                wrapper.appendChild(overlay);
            }
        }
        
        // Mouse hover interactions
        areaEl.addEventListener("mouseover", (e) => {
            tooltip.style.display = "flex";
            const fcText = area.log2fc !== null ? 
                `<span class="tooltip-fc ${area.log2fc >= 0 ? 'up-text' : 'down-text'}">Log2FC: ${area.log2fc > 0 ? '+' : ''}${area.log2fc}</span>` : 
                '<span class="text-muted">발현 데이터 미매칭</span>';
                
            tooltip.innerHTML = `
                <span class="tooltip-gene">${area.gene}</span>
                ${fcText}
                <span class="tooltip-desc">${area.title}</span>
            `;
            updateTooltipPosition(e, tooltip);
        });
        
        areaEl.addEventListener("mousemove", (e) => {
            updateTooltipPosition(e, tooltip);
        });
        
        areaEl.addEventListener("mouseout", () => {
            tooltip.style.display = "none";
        });
        
        areaEl.addEventListener("click", (e) => {
            e.preventDefault();
            
            // Support searching by locus_tag or gene_symbol in a multi-gene entry
            let match = null;
            // area.gene might be like "YAL038W+YOR347C"
            const genesList = area.gene.toUpperCase().split("+");
            for (const gCode of genesList) {
                match = gGenes.find(g => 
                    g.locus_tag.toUpperCase() === gCode || 
                    g.gene_symbol.toUpperCase() === gCode
                );
                if (match) break;
            }
            
            if (match) {
                showGeneDetailsModal(match);
            }
        });
        
        map.appendChild(areaEl);
    });
    
    wrapper.appendChild(map);
    container.appendChild(wrapper);
}

function updateTooltipPosition(e, tooltip) {
    // Offset relative to mouse
    tooltip.style.left = `${e.pageX + 15}px`;
    tooltip.style.top = `${e.pageY + 15}px`;
}

// Modal Detail View (For KEGG area clicks)
function showGeneDetailsModal(gene) {
    const modal = document.getElementById("gene-modal");
    document.getElementById("modal-gene-title").textContent = `${gene.gene_symbol} (${gene.locus_tag})`;
    document.getElementById("modal-gene-desc").textContent = gene.description || '유전자 설명이 존재하지 않습니다.';
    
    modal.style.display = "flex";
    
    // Close button
    document.getElementById("close-modal").onclick = () => {
        modal.style.display = "none";
    };
    
    // Click outside to close
    window.onclick = (e) => {
        if (e.target === modal) {
            modal.style.display = "none";
        }
    };
    
    // Redraw modal chart
    let trace1, trace2;
    
    if (gIsReplicateMode && gene.wt_reps && gene.mut_reps) {
        trace1 = {
            x: ['WT', 'Mutant'],
            y: [gene.wt_val, gene.mutant_val],
            type: 'bar',
            name: '평균값',
            marker: { color: ['rgba(59, 130, 246, 0.4)', 'rgba(239, 68, 68, 0.4)'] }
        };
        
        const repX = [];
        const repY = [];
        gene.wt_reps.forEach(v => { repX.push('WT'); repY.push(v); });
        gene.mut_reps.forEach(v => { repX.push('Mutant'); repY.push(v); });
        
        trace2 = {
            x: repX,
            y: repY,
            mode: 'markers',
            type: 'scatter',
            name: '반복구',
            marker: { size: 12, color: ['#3b82f6', '#3b82f6', '#3b82f6', '#ff4d4d', '#ff4d4d', '#ff4d4d'], opacity: 0.9 }
        };
    } else {
        trace1 = {
            x: ['WT', 'Mutant'],
            y: [gene.wt_val, gene.mutant_val],
            type: 'bar',
            marker: { color: ['#3b82f6', '#ff4d4d'] }
        };
    }
    
    const layout = {
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { color: '#0f172a', family: 'Inter, sans-serif' },
        xaxis: { gridcolor: '#e2e8f0' },
        yaxis: { title: 'Expression (TPM/FPKM)', gridcolor: '#e2e8f0' }
    };
    
    const data = trace2 ? [trace1, trace2] : [trace1];
    Plotly.newPlot('modal-chart', data, layout, {responsive: true});
}

// ----------------------------------------------------------------------
// 8. GO Enrichment
// ----------------------------------------------------------------------
function runGOEnrichment() {
    const direction = document.getElementById("go-direction").value;
    const log2fcThresh = parseFloat(document.getElementById("log2fc-thresh").value) || 0;
    const pvalThresh = parseFloat(document.getElementById("pvalue-thresh").value) || 1.0;
    
    // Select upregulated or downregulated locus tags based on threshold and stat-type
    const targetList = [];
    const statType = document.getElementById("stat-type") ? document.getElementById("stat-type").value : "fdr";
    gGenes.forEach(gene => {
        const statVal = statType === "fdr" ? gene.fdr : gene.pvalue;
        const passesLog2FC = Math.abs(gene.log2fc) >= log2fcThresh;
        let passesPVal = true;
        if (statType !== "none" && gIsReplicateMode) {
            passesPVal = (statVal !== null && statVal <= pvalThresh);
        }
        
        if (passesLog2FC && passesPVal) {
            if (direction === "up" && gene.log2fc >= log2fcThresh) {
                targetList.push(gene.locus_tag);
            } else if (direction === "down" && gene.log2fc <= -log2fcThresh) {
                targetList.push(gene.locus_tag);
            }
        }
    });
    
    const tbody = document.getElementById("go-table-body");
    tbody.innerHTML = `<tr><td colspan="8" class="text-center"><i class="fa-solid fa-spinner fa-spin icon-margin"></i>GO Enrichment 검정 수행 중... (수초가 소요될 수 있습니다)</td></tr>`;
    
    if (targetList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">선택한 임계값을 충족하는 ${direction === "up" ? '증가' : '감소'} 발현 유전자가 없습니다. 필터 조건을 완화해보세요.</td></tr>`;
        return;
    }
    
    fetch(`${API_URL}/api/go_enrichment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            genes: targetList,
            direction: direction
        })
    })
    .then(r => {
        if (!r.ok) {
            return r.json().then(err => { throw new Error(err.detail || "GO 분석 실패") });
        }
        return r.json();
    })
    .then(data => {
        runDomainEnrichment(targetList);
        tbody.innerHTML = "";
        
        const enrichList = data.enrichment || [];
        if (enrichList.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">유의미하게 농축된 GO 카테고리가 없습니다.</td></tr>`;
            document.getElementById("go-chart-container").style.display = "none";
            return;
        }
        
        // Group by ontology aspect and sort by pvalue ascending (lower is more significant)
        const aspectOrder = ["Molecular Function", "Cellular Component", "Biological Process"];
        const groupedList = [];
        
        aspectOrder.forEach(asp => {
            const subList = enrichList.filter(item => item.aspect === asp);
            subList.sort((a, b) => a.pvalue - b.pvalue);
            groupedList.push(...subList);
        });
        
        enrichList.forEach(item => {
            if (!aspectOrder.includes(item.aspect)) {
                groupedList.push(item);
            }
        });
        
        // Render sorted and grouped list to Table
        groupedList.slice(0, 100).forEach(item => {
            const row = document.createElement("tr");
            const genesListStr = item.genes.join(", ");
            const genesSnippet = genesListStr.length > 40 ? genesListStr.substring(0, 40) + "..." : genesListStr;
            
            row.innerHTML = `
                <td><code>${item.goid}</code></td>
                <td>${item.aspect}</td>
                <td><strong>${item.term_name}</strong></td>
                <td class="text-center">${item.k}</td>
                <td class="text-center">${item.M}</td>
                <td>${item.pvalue.toExponential(4)}</td>
                <td>${item.fdr.toExponential(4)}</td>
                <td class="text-muted" title="${genesListStr}">${genesSnippet}</td>
            `;
            tbody.appendChild(row);
        });

        // Group terms for Plotly horizontal bar chart
        // Extract top 8 terms for each category
        const molTerms = groupedList.filter(item => item.aspect === "Molecular Function").slice(0, 8);
        const cellTerms = groupedList.filter(item => item.aspect === "Cellular Component").slice(0, 8);
        const bioTerms = groupedList.filter(item => item.aspect === "Biological Process").slice(0, 8);
        
        // Reverse arrays for correct bottom-to-top categorical plotting in Plotly
        const chartTerms = [...molTerms.reverse(), ...cellTerms.reverse(), ...bioTerms.reverse()];
        
        if (chartTerms.length > 0) {
            document.getElementById("go-chart-container").style.display = "block";
            const allLabels = chartTerms.map(t => `${t.term_name} (${t.goid})`);
            
            const molTrace = {
                x: chartTerms.map(t => t.aspect === "Molecular Function" ? -Math.log10(t.fdr || t.pvalue || 1e-10) : null),
                y: allLabels,
                name: 'Molecular Function',
                type: 'bar',
                orientation: 'h',
                marker: { color: '#3b82f6' }
            };
            
            const cellTrace = {
                x: chartTerms.map(t => t.aspect === "Cellular Component" ? -Math.log10(t.fdr || t.pvalue || 1e-10) : null),
                y: allLabels,
                name: 'Cellular Component',
                type: 'bar',
                orientation: 'h',
                marker: { color: '#10b981' }
            };
            
            const bioTrace = {
                x: chartTerms.map(t => t.aspect === "Biological Process" ? -Math.log10(t.fdr || t.pvalue || 1e-10) : null),
                y: allLabels,
                name: 'Biological Process',
                type: 'bar',
                orientation: 'h',
                marker: { color: '#f87171' }
            };
            
            const layout = {
                title: {
                    text: 'Gene Ontology Enrichment Results (-log10 q-value)',
                    font: { size: 16, color: '#0f172a', family: 'Inter, sans-serif' }
                },
                barmode: 'overlay',
                xaxis: {
                    title: '-log10(qvalue 또는 pvalue)',
                    gridcolor: '#e2e8f0',
                    zerolinecolor: '#cbd5e1',
                    tickfont: { color: '#475569' }
                },
                yaxis: {
                    type: 'category',
                    categoryorder: 'array',
                    categoryarray: allLabels,
                    tickfont: { size: 10, color: '#0f172a' },
                    automargin: true
                },
                margin: { l: 280, r: 20, t: 50, b: 50 },
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor: 'rgba(0,0,0,0)',
                legend: {
                    title: { text: 'GO Aspect' },
                    font: { color: '#0f172a' },
                    orientation: 'h',
                    y: -0.2
                }
            };
            
            Plotly.newPlot('go-bar-chart', [molTrace, cellTrace, bioTrace], layout, {responsive: true});
        } else {
            document.getElementById("go-chart-container").style.display = "none";
        }
    })
    .catch(err => {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">에러 발생: ${err.message}</td></tr>`;
    });
}

// ----------------------------------------------------------------------
// 9. Protein Domain Enrichment (Pfam/InterPro)
// ----------------------------------------------------------------------
function runDomainEnrichment(targetList) {
    const tbody = document.getElementById("domain-table-body");
    tbody.innerHTML = `<tr><td colspan="5" class="text-center"><i class="fa-solid fa-spinner fa-spin icon-margin"></i>도메인 농축 검정 수행 중...</td></tr>`;
    
    fetch(`${API_URL}/api/domain_enrichment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ genes: targetList })
    })
    .then(r => r.json())
    .then(data => {
        tbody.innerHTML = "";
        const list = data.enrichment || [];
        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">유의미하게 농축된 도메인이 없습니다.</td></tr>`;
            Plotly.purge('domain-pie-chart');
            return;
        }
        
        list.slice(0, 30).forEach(item => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><code>${item.domain_id}</code></td>
                <td><strong>${item.domain_name}</strong></td>
                <td class="text-center">${item.k} / ${item.M}</td>
                <td>${item.pvalue.toExponential(4)}</td>
                <td>${item.fdr.toExponential(4)}</td>
            `;
            tbody.appendChild(tr);
        });
        
        const top5 = list.slice(0, 5);
        const pieData = [{
            values: top5.map(d => d.k),
            labels: top5.map(d => `${d.domain_name} (${d.domain_id})`),
            type: 'pie',
            hole: 0.4,
            marker: {
                colors: ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f59e0b']
            }
        }];
        const pieLayout = {
            title: {
                text: '상위 농축 도메인 분포 (Hit 개수)',
                font: { size: 13, color: '#0f172a', family: 'Inter, sans-serif' }
            },
            showlegend: false,
            margin: { l: 20, r: 20, t: 40, b: 20 },
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)'
        };
        Plotly.newPlot('domain-pie-chart', pieData, pieLayout, {responsive: true});
    })
    .catch(err => {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">도메인 분석 에러: ${err.message}</td></tr>`;
    });
}

// ----------------------------------------------------------------------
// 10. Principal Component Analysis (PCA)
// ----------------------------------------------------------------------
function renderPCAPlot() {
    if (gGenes.length === 0) return;
    
    const chartDiv = document.getElementById("pca-scatter-chart");
    chartDiv.innerHTML = `<div style="text-align: center; padding-top: 150px; color: #64748b;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><p style="margin-top: 10px;">PCA 차원 축소 연산 중...</p></div>`;
    
    fetch(`${API_URL}/api/pca`)
    .then(r => {
        if (!r.ok) return r.json().then(e => { throw new Error(e.detail || "PCA 연산 실패") });
        return r.json();
    })
    .then(data => {
        const results = data.results || [];
        if (results.length === 0) {
            chartDiv.innerHTML = `<div class="text-center text-muted" style="padding-top: 150px;">PCA 연산을 위한 반복구 데이터가 부족합니다.</div>`;
            return;
        }
        
        const wtPoints = results.filter(r => r.group === "WT");
        const mutPoints = results.filter(r => r.group === "Mutant");
        
        const traceWT = {
            x: wtPoints.map(p => p.pc1),
            y: wtPoints.map(p => p.pc2),
            mode: 'markers+text',
            type: 'scatter',
            name: '대조군 (WT)',
            text: wtPoints.map(p => p.sample),
            textposition: 'top center',
            marker: { size: 16, color: '#3b82f6', symbol: 'circle' }
        };
        
        const traceMut = {
            x: mutPoints.map(p => p.pc1),
            y: mutPoints.map(p => p.pc2),
            mode: 'markers+text',
            type: 'scatter',
            name: '실험군 (Mutant)',
            text: mutPoints.map(p => p.sample),
            textposition: 'top center',
            marker: { size: 16, color: '#ef4444', symbol: 'square' }
        };
        
        const layout = {
            title: {
                text: `PCA 주성분 분포 (PC1: ${(data.pc1_var * 100).toFixed(1)}% / PC2: ${(data.pc2_var * 100).toFixed(1)}%)`,
                font: { size: 16, color: '#0f172a', family: 'Inter, sans-serif' }
            },
            xaxis: { title: 'Principal Component 1 (PC1)', gridcolor: '#e2e8f0', zerolinecolor: '#cbd5e1' },
            yaxis: { title: 'Principal Component 2 (PC2)', gridcolor: '#e2e8f0', zerolinecolor: '#cbd5e1' },
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            hovermode: 'closest',
            margin: { l: 60, r: 40, t: 60, b: 60 }
        };
        
        chartDiv.innerHTML = "";
        Plotly.newPlot('pca-scatter-chart', [traceWT, traceMut], layout, {responsive: true});
    })
    .catch(err => {
        chartDiv.innerHTML = `<div class="text-center text-danger" style="padding-top: 150px;"><i class="fa-solid fa-circle-exclamation fa-2x mb-10"></i><p>PCA 수행 실패: ${err.message}</p></div>`;
    });
}

// ----------------------------------------------------------------------
// 11. STRING PPI Network Graph
// ----------------------------------------------------------------------
let cyInstance = null;
function renderNetworkGraph() {
    const limit = document.getElementById("network-limit").value;
    const score = document.getElementById("network-score").value;
    
    const container = document.getElementById("cy-network");
    container.innerHTML = `<div style="text-align: center; padding-top: 200px; color: #64748b;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><p style="margin-top: 10px;">STRING-DB 상호작용 정보 다운로드 중...</p></div>`;
    
    fetch(`${API_URL}/api/network?limit=${limit}&score=${score}`)
    .then(r => r.json())
    .then(data => {
        if (!data.success) {
            container.innerHTML = `<div class="text-center text-danger" style="padding-top: 200px;"><i class="fa-solid fa-triangle-exclamation fa-2x mb-10"></i><p>${data.detail}</p></div>`;
            return;
        }
        
        const nodes = data.nodes || [];
        const edges = data.edges || [];
        
        if (nodes.length === 0) {
            container.innerHTML = `<div class="text-center text-muted" style="padding-top: 200px;">상위 DEG 유전자들에 매칭되는 상호작용 노드가 없습니다.</div>`;
            return;
        }
        
        container.innerHTML = "";
        
        const elements = [];
        nodes.forEach(n => {
            let color = '#cbd5e1';
            if (n.log2fc > 0) {
                const intensity = Math.min(n.log2fc / 2.0, 1.0);
                color = `rgb(${255}, ${Math.round(255 - 200 * intensity)}, ${Math.round(255 - 200 * intensity)})`;
            } else if (n.log2fc < 0) {
                const intensity = Math.min(Math.abs(n.log2fc) / 2.0, 1.0);
                color = `rgb(${Math.round(255 - 200 * intensity)}, ${Math.round(255 - 200 * intensity)}, ${255})`;
            }
            
            elements.push({
                data: {
                    id: n.id,
                    label: n.label,
                    log2fc: n.log2fc,
                    desc: n.desc,
                    bg: color
                }
            });
        });
        
        edges.forEach((e, idx) => {
            elements.push({
                data: {
                    id: `e_${idx}`,
                    source: e.source,
                    target: e.target,
                    weight: e.score / 1000.0
                }
            });
        });
        
        cyInstance = cytoscape({
            container: container,
            elements: elements,
            style: [
                {
                    selector: 'node',
                    style: {
                        'label': 'data(label)',
                        'background-color': 'data(bg)',
                        'border-width': '2px',
                        'border-color': '#1e293b',
                        'color': '#0f172a',
                        'font-size': '12px',
                        'font-weight': 'bold',
                        'text-valign': 'center',
                        'text-halign': 'center',
                        'width': '50px',
                        'height': '50px',
                        'overlay-padding': '4px',
                        'text-outline-width': '2px',
                        'text-outline-color': '#ffffff'
                    }
                },
                {
                    selector: 'edge',
                    style: {
                        'width': 'mapData(weight, 0.4, 1.0, 1.5, 4.0)',
                        'line-color': '#94a3b8',
                        'curve-style': 'bezier',
                        'opacity': 0.7
                    }
                }
            ],
            layout: {
                name: 'cose',
                animate: true,
                nodeRepulsion: function( node ){ return 2048; },
                idealEdgeLength: function( edge ){ return 64; },
                fit: true
            }
        });
        
        const detailsPanel = document.getElementById("network-node-details");
        cyInstance.on('tap', 'node', function(evt){
            const nodeData = evt.target.data();
            detailsPanel.innerHTML = `
                <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 12px; margin-bottom: 12px;">
                    <span style="font-size: 11px; font-weight: 600; color: #6366f1; text-transform: uppercase;">ORF Name</span>
                    <h5 style="font-size: 16px; font-weight: 700; color: #0f172a; margin: 2px 0;">${nodeData.id}</h5>
                </div>
                <div style="margin-bottom: 10px;">
                    <span style="font-size: 11px; font-weight: 600; color: #64748b;">Gene Symbol</span>
                    <p style="font-size: 14px; font-weight: 500; color: #1e293b; margin: 2px 0;">${nodeData.label}</p>
                </div>
                <div style="margin-bottom: 10px;">
                    <span style="font-size: 11px; font-weight: 600; color: #64748b;">Log2 Fold Change</span>
                    <p style="font-size: 14px; font-weight: 600; color: ${nodeData.log2fc >= 0 ? '#ef4444' : '#3b82f6'}; margin: 2px 0;">
                        ${nodeData.log2fc >= 0 ? '+' : ''}${nodeData.log2fc.toFixed(4)}
                    </p>
                </div>
                <div>
                    <span style="font-size: 11px; font-weight: 600; color: #64748b;">Description</span>
                    <p style="font-size: 13px; line-height: 1.5; color: #475569; margin: 2px 0; max-height: 200px; overflow-y: auto;">
                        ${nodeData.desc || '정보 없음'}
                    </p>
                </div>
            `;
        });
    })
    .catch(err => {
        container.innerHTML = `<div class="text-center text-danger" style="padding-top: 200px;"><i class="fa-solid fa-circle-exclamation fa-2x mb-10"></i><p>네트워크 렌더링 실패: ${err.message}</p></div>`;
    });
}

// ----------------------------------------------------------------------
// 12. GSEA Enrichment Score Plot
// ----------------------------------------------------------------------
let gGseaTerms = [];
function loadGSEATerms() {
    const listContainer = document.getElementById("gsea-terms-list");
    listContainer.innerHTML = `<div style="text-align: center; padding-top: 40px; color: #64748b;"><i class="fa-solid fa-spinner fa-spin"></i><p style="font-size: 12px; margin-top: 6px;">유전자 범주 불러오는 중...</p></div>`;
    
    fetch(`${API_URL}/api/gsea_terms`)
    .then(r => r.json())
    .then(data => {
        gGseaTerms = data.terms || [];
        renderGSEAList(gGseaTerms);
        
        const searchInput = document.getElementById("gsea-search");
        searchInput.replaceWith(searchInput.cloneNode(true));
        document.getElementById("gsea-search").addEventListener("input", (e) => {
            const val = e.target.value.toLowerCase();
            const filtered = gGseaTerms.filter(t => t.name.toLowerCase().includes(val) || t.term_id.toLowerCase().includes(val));
            renderGSEAList(filtered);
        });
    })
    .catch(err => {
        listContainer.innerHTML = `<p class="text-center text-danger" style="padding: 20px;">범주 로드 실패: ${err.message}</p>`;
    });
}

function renderGSEAList(terms) {
    const listContainer = document.getElementById("gsea-terms-list");
    listContainer.innerHTML = "";
    if (terms.length === 0) {
        listContainer.innerHTML = `<p class="text-center text-muted" style="padding: 20px 0;">검색 결과가 없습니다.</p>`;
        return;
    }
    
    terms.forEach(t => {
        const div = document.createElement("div");
        div.className = "kegg-item";
        div.style.padding = "10px 12px";
        div.style.borderBottom = "1px solid #f1f5f9";
        div.innerHTML = `
            <div style="font-weight: 600; font-size: 13px; color: #0f172a;">${t.name}</div>
            <div style="display: flex; justify-content: space-between; font-size: 11px; margin-top: 4px; color: #64748b;">
                <span><code>${t.term_id}</code></span>
                <span>${t.count} genes</span>
            </div>
        `;
        div.addEventListener("click", () => {
            const items = listContainer.querySelectorAll(".kegg-item");
            items.forEach(i => i.classList.remove("active"));
            div.classList.add("active");
            
            runGSEAAnalysis(t.term_id, t.name);
        });
        listContainer.appendChild(div);
    });
}

function runGSEAAnalysis(termId, termName) {
    const runningDiv = document.getElementById("gsea-running-plot");
    const barcodeDiv = document.getElementById("gsea-barcode-plot");
    
    runningDiv.innerHTML = `<div style="text-align: center; padding-top: 100px; color: #64748b;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><p style="margin-top: 8px;">GSEA Running Enrichment Score 계산 중...</p></div>`;
    barcodeDiv.innerHTML = "";
    
    fetch(`${API_URL}/api/gsea_run/${termId}`)
    .then(r => r.json())
    .then(data => {
        if (!data.success) {
            runningDiv.innerHTML = `<div class="text-center text-danger" style="padding-top: 100px;">GSEA 계산 실패: ${data.detail}</div>`;
            return;
        }
        
        const profile = data.es_profile || [];
        const barcodes = data.barcode_ranks || [];
        
        const traceES = {
            x: profile.map(p => p.rank),
            y: profile.map(p => p.es),
            mode: 'lines',
            type: 'scatter',
            name: 'Enrichment Score',
            line: { color: '#22c55e', width: 3.5 }
        };
        
        const traceZero = {
            x: [0, profile.length ? profile[profile.length - 1].rank : 1000],
            y: [0, 0],
            mode: 'lines',
            name: 'Zero Line',
            line: { color: '#cbd5e1', dash: 'dash', width: 1.5 },
            showlegend: false
        };
        
        const runningLayout = {
            title: {
                text: `GSEA Running Score for "${termName}" (ES Peak: ${data.nes.toFixed(4)})`,
                font: { size: 14, color: '#0f172a', family: 'Inter, sans-serif' }
            },
            xaxis: { title: 'Ranked Gene List Index', showgrid: false },
            yaxis: { title: 'Enrichment Score (ES)', gridcolor: '#e2e8f0' },
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            margin: { l: 60, r: 20, t: 50, b: 40 },
            hovermode: 'closest'
        };
        
        runningDiv.innerHTML = "";
        Plotly.newPlot('gsea-running-plot', [traceES, traceZero], runningLayout, {responsive: true});
        
        const barcodeX = barcodes.map(b => b.rank);
        
        const traceBarcode = {
            x: barcodeX,
            y: Array(barcodeX.length).fill(1.0),
            type: 'bar',
            name: 'Hit',
            width: 3.0,
            marker: { color: '#0f172a', opacity: 0.8 },
            showlegend: false
        };
        
        const barcodeLayout = {
            title: {
                text: 'Gene Hits in Ranked List',
                font: { size: 11, color: '#64748b', family: 'Inter, sans-serif' }
            },
            xaxis: { title: 'Ranked Index', showgrid: false, range: [0, profile.length ? profile[profile.length - 1].rank : 1000] },
            yaxis: { showgrid: false, showticklabels: false, range: [0, 1.2] },
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            margin: { l: 60, r: 20, t: 30, b: 30 }
        };
        
        barcodeDiv.innerHTML = "";
        Plotly.newPlot('gsea-barcode-plot', [traceBarcode], barcodeLayout, {responsive: true});
    })
    .catch(err => {
        runningDiv.innerHTML = `<div class="text-center text-danger" style="padding-top: 100px;">오류: ${err.message}</div>`;
    });
}
