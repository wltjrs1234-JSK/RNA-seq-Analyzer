/**
 * Yeast RNA-seq Analyzer Dashboard Logic
 */

// Global state variables
let gGenes = [];
let gIsReplicateMode = false;
let gSelectedGene = null;
let gActiveTab = 'upload-tab';
let gPathwayList = [];
let gCurrentSortKey = null;
let gCurrentSortOrder = 'none'; // 'none', 'asc', 'desc'

// Base API URL (can be blank since we are hosting static files on same port)
const API_URL = "";

document.addEventListener("DOMContentLoaded", () => {
    const runInit = (name, fn) => {
        try {
            fn();
        } catch (e) {
            console.error(`[Init Error] Failed to execute ${name}:`, e);
        }
    };
    
    runInit("initTabs", initTabs);
    runInit("initDropzone", initDropzone);
    runInit("initControls", initControls);
    runInit("initAdvancedAnalysisBindings", initAdvancedAnalysisBindings);
    runInit("initGSHZoomPan", initGSHZoomPan);
    runInit("initGSHEditorBindings", initGSHEditorBindings);
    
    runInit("loadMockBtn", () => {
        const mockBtn = document.getElementById("load-mock-btn");
        if (mockBtn) {
            mockBtn.addEventListener("click", loadMockData);
        }
    });
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
    } else if (tabId === 'motif-tab') {
        renderMotifLogoPlaceholder();
    } else if (tabId === 'custom-pathway-tab') {
        loadGSHPathwayData();
        resetGSHZoom();
    }
}

// Enable tabs after successful upload
function enableAnalysisTabs() {
    const disabledIds = ["nav-deg", "nav-volcano", "nav-pca", "nav-heatmap", "nav-kegg", "nav-go", "nav-network", "nav-gsea", "nav-motif", "nav-advanced", "nav-custom-pathway"];
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
    
    // Assign original order index for sort reset fallback
    gGenes.forEach((gene, index) => {
        gene.original_index = index;
    });
    
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
    
    const heatmapHeightInput = document.getElementById("heatmap-height");
    if (heatmapHeightInput) {
        heatmapHeightInput.addEventListener("input", (e) => {
            document.getElementById("heatmap-height-val").textContent = `${e.target.value}px`;
            renderHeatmap();
        });
    }
    
    const heatmapDendroGapInput = document.getElementById("heatmap-dendro-gap");
    if (heatmapDendroGapInput) {
        heatmapDendroGapInput.addEventListener("input", (e) => {
            document.getElementById("heatmap-dendro-gap-val").textContent = `${e.target.value}%`;
            renderHeatmap();
        });
    }
    
    const heatmapDendroGapTopInput = document.getElementById("heatmap-dendro-gap-top");
    if (heatmapDendroGapTopInput) {
        heatmapDendroGapTopInput.addEventListener("input", (e) => {
            document.getElementById("heatmap-dendro-gap-top-val").textContent = `${e.target.value}%`;
            renderHeatmap();
        });
    }
    
    const heatmapMarginBottomInput = document.getElementById("heatmap-margin-bottom");
    if (heatmapMarginBottomInput) {
        heatmapMarginBottomInput.addEventListener("input", (e) => {
            document.getElementById("heatmap-margin-bottom-val").textContent = `${e.target.value}px`;
            renderHeatmap();
        });
    }
    
    // Sample order control event listeners
    const sampleOrderTypeSelect = document.getElementById("heatmap-sample-order-type");
    const sampleOrderCustomContainer = document.getElementById("sample-order-custom-container");
    const sampleOrderCustomInput = document.getElementById("heatmap-sample-order-custom");
    
    if (sampleOrderTypeSelect) {
        sampleOrderTypeSelect.addEventListener("change", (e) => {
            if (e.target.value === "custom") {
                sampleOrderCustomContainer.style.display = "block";
            } else {
                sampleOrderCustomContainer.style.display = "none";
            }
            renderHeatmap();
        });
    }
    
    if (sampleOrderCustomInput) {
        sampleOrderCustomInput.addEventListener("input", () => {
            renderHeatmap();
        });
    }
    
    // Clustering check change to enable/disable manual sample ordering
    const heatmapClusterCheck = document.getElementById("heatmap-cluster");
    if (heatmapClusterCheck) {
        // Run once on load to set initial state
        const toggleSampleOrderFields = () => {
            if (heatmapClusterCheck.checked) {
                if (sampleOrderTypeSelect) {
                    sampleOrderTypeSelect.disabled = true;
                    sampleOrderTypeSelect.style.opacity = "0.5";
                }
                sampleOrderCustomContainer.style.display = "none";
            } else {
                if (sampleOrderTypeSelect) {
                    sampleOrderTypeSelect.disabled = false;
                    sampleOrderTypeSelect.style.opacity = "1.0";
                    if (sampleOrderTypeSelect.value === "custom") {
                        sampleOrderCustomContainer.style.display = "block";
                    }
                }
            }
        };
        heatmapClusterCheck.addEventListener("change", () => {
            toggleSampleOrderFields();
            renderHeatmap();
        });
        // Attach initial hook invocation in case mock data finalization triggers
        document.addEventListener("DOMContentLoaded", toggleSampleOrderFields);
        // Let's also run this after data load finalization
    }
    
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

    // Add sorting listeners for DEG table headers
    document.querySelectorAll(".sortable-header").forEach(th => {
        th.addEventListener("click", () => {
            const key = th.getAttribute("data-sort-key");
            handleHeaderSort(key, th);
        });
    });

    // KEGG Pathway Gene Search Input Event
    const keggSearchInput = document.getElementById("kegg-search-gene");
    if (keggSearchInput) {
        keggSearchInput.addEventListener("input", (e) => {
            renderPathwayList(e.target.value);
        });
    }

    // DEG Excel Export Binding
    const btnExportExcel = document.getElementById("btn-export-deg-excel");
    if (btnExportExcel) {
        btnExportExcel.addEventListener("click", () => {
            window.open(`${API_URL}/api/export_deg_excel`, '_blank');
        });
    }
    
    // Volcano / MA Plot Export Bindings
    const btnExportVolcanoJpg = document.getElementById("btn-export-volcano-jpg");
    const btnExportVolcanoPdf = document.getElementById("btn-export-volcano-pdf");
    if (btnExportVolcanoJpg) {
        btnExportVolcanoJpg.addEventListener("click", () => exportPlotlyChart("plotly-chart", "jpeg", "yeast_volcano_ma_plot"));
    }
    if (btnExportVolcanoPdf) {
        btnExportVolcanoPdf.addEventListener("click", () => exportPlotlyChart("plotly-chart", "pdf", "yeast_volcano_ma_plot"));
    }
    
    // Heatmap Export Bindings
    const btnExportHeatmapJpg = document.getElementById("btn-export-heatmap-jpg");
    const btnExportHeatmapPdf = document.getElementById("btn-export-heatmap-pdf");
    if (btnExportHeatmapJpg) {
        btnExportHeatmapJpg.addEventListener("click", () => exportPlotlyChart("plotly-heatmap", "jpeg", "yeast_expression_heatmap"));
    }
    if (btnExportHeatmapPdf) {
        btnExportHeatmapPdf.addEventListener("click", () => exportPlotlyChart("plotly-heatmap", "pdf", "yeast_expression_heatmap"));
    }
    
    // PCA Plot Export Bindings
    const btnExportPcaJpg = document.getElementById("btn-export-pca-jpg");
    const btnExportPcaPdf = document.getElementById("btn-export-pca-pdf");
    if (btnExportPcaJpg) {
        btnExportPcaJpg.addEventListener("click", () => exportPlotlyChart("pca-scatter-chart", "jpeg", "yeast_pca_plot"));
    }
    if (btnExportPcaPdf) {
        btnExportPcaPdf.addEventListener("click", () => exportPlotlyChart("pca-scatter-chart", "pdf", "yeast_pca_plot"));
    }
    
    // GO Enrichment Export Bindings
    const btnExportGoJpg = document.getElementById("btn-export-go-jpg");
    const btnExportGoPdf = document.getElementById("btn-export-go-pdf");
    if (btnExportGoJpg) {
        btnExportGoJpg.addEventListener("click", () => exportPlotlyChart("go-bar-chart", "jpeg", "yeast_go_enrichment_chart"));
    }
    if (btnExportGoPdf) {
        btnExportGoPdf.addEventListener("click", () => exportPlotlyChart("go-bar-chart", "pdf", "yeast_go_enrichment_chart"));
    }
    
    // KEGG Map Export Bindings
    const btnExportKeggJpg = document.getElementById("btn-export-kegg-jpg");
    const btnExportKeggPdf = document.getElementById("btn-export-kegg-pdf");
    if (btnExportKeggJpg) {
        btnExportKeggJpg.addEventListener("click", () => exportKeggMap("jpeg", "yeast_kegg_pathway_map"));
    }
    if (btnExportKeggPdf) {
        btnExportKeggPdf.addEventListener("click", () => exportKeggMap("pdf", "yeast_kegg_pathway_map"));
    }
    
    // ------------------------------------------------------------------
    // Gene Detail Modal Bindings
    // ------------------------------------------------------------------
    const closeModalBtn = document.getElementById("close-modal");
    if (closeModalBtn) {
        closeModalBtn.addEventListener("click", () => {
            document.getElementById("gene-modal").style.display = "none";
        });
    }
    window.addEventListener("click", (event) => {
        const modal = document.getElementById("gene-modal");
        if (event.target === modal) {
            modal.style.display = "none";
        }
    });

    // ------------------------------------------------------------------
    // Transcription Factor & STRING Network Toggle Bindings
    // ------------------------------------------------------------------
    const btnNetString = document.getElementById("btn-net-mode-string");
    const btnNetTF = document.getElementById("btn-net-mode-tf");
    const stringControls = document.getElementById("string-controls-wrapper");
    const subtabTFList = document.getElementById("btn-subtab-tflist");
    
    if (btnNetString && btnNetTF) {
        btnNetString.addEventListener("click", () => {
            btnNetString.classList.add("active");
            btnNetTF.classList.remove("active");
            document.getElementById("network-tab-title").textContent = "STRING-DB 단백질 상호작용 네트워크";
            if (stringControls) stringControls.style.display = "flex";
            if (subtabTFList) subtabTFList.style.display = "none";
            
            // Switch back to details subtab
            document.getElementById("btn-subtab-node").click();
            
            gNetworkMode = 'string';
            renderNetworkGraph();
        });
        
        btnNetTF.addEventListener("click", () => {
            btnNetTF.classList.add("active");
            btnNetString.classList.remove("active");
            document.getElementById("network-tab-title").textContent = "전사조절 (TF-Target) 네트워크 분석";
            if (stringControls) stringControls.style.display = "none";
            if (subtabTFList) subtabTFList.style.display = "block";
            
            // Switch to TF List subtab by default for TF mode
            if (subtabTFList) subtabTFList.click();
            
            gNetworkMode = 'tf';
            renderNetworkGraph();
        });
    }
    
    // Network Side Bar Subtabs Toggle Bindings
    const btnSubtabNode = document.getElementById("btn-subtab-node");
    const btnSubtabTFList = document.getElementById("btn-subtab-tflist");
    const nodeDetailsArea = document.getElementById("network-node-details");
    const tfListArea = document.getElementById("network-tf-list-container");
    
    if (btnSubtabNode && btnSubtabTFList) {
        btnSubtabNode.addEventListener("click", () => {
            btnSubtabNode.classList.add("active");
            btnSubtabNode.style.color = "var(--primary-color)";
            btnSubtabNode.style.borderBottom = "2px solid var(--primary-color)";
            
            btnSubtabTFList.classList.remove("active");
            btnSubtabTFList.style.color = "var(--text-muted)";
            btnSubtabTFList.style.borderBottom = "none";
            
            if (nodeDetailsArea) nodeDetailsArea.style.display = "block";
            if (tfListArea) tfListArea.style.display = "none";
        });
        
        btnSubtabTFList.addEventListener("click", () => {
            btnSubtabTFList.classList.add("active");
            btnSubtabTFList.style.color = "var(--primary-color)";
            btnSubtabTFList.style.borderBottom = "2px solid var(--primary-color)";
            
            btnSubtabNode.classList.remove("active");
            btnSubtabNode.style.color = "var(--text-muted)";
            btnSubtabNode.style.borderBottom = "none";
            
            if (nodeDetailsArea) nodeDetailsArea.style.display = "none";
            if (tfListArea) tfListArea.style.display = "block";
        });
    }
    
    // Rebuild Network Button
    const btnRebuild = document.getElementById("btn-rebuild-network");
    if (btnRebuild) {
        btnRebuild.addEventListener("click", () => {
            renderNetworkGraph();
        });
    }

    // ------------------------------------------------------------------
    // Motif Discovery Bindings
    // ------------------------------------------------------------------
    const btnRunMotif = document.getElementById("btn-run-motif");
    if (btnRunMotif) {
        btnRunMotif.addEventListener("click", () => {
            runMotifAnalysis();
        });
    }
    const btnExportMotifJpg = document.getElementById("btn-export-motif-jpg");
    const btnExportMotifPdf = document.getElementById("btn-export-motif-pdf");
    if (btnExportMotifJpg) {
        btnExportMotifJpg.addEventListener("click", () => exportPlotlyChart("motif-logo-chart", "jpeg", "yeast_motif_logo"));
    }
    if (btnExportMotifPdf) {
        btnExportMotifPdf.addEventListener("click", () => exportPlotlyChart("motif-logo-chart", "pdf", "yeast_motif_logo"));
    }
    
    // Custom GSH Pathway Refresh Binding
    const btnRefreshGsh = document.getElementById("btn-refresh-gsh-pathway");
    if (btnRefreshGsh) {
        btnRefreshGsh.addEventListener("click", loadGSHPathwayData);
    }
}

function handleHeaderSort(key, thEl) {
    if (gCurrentSortKey === key) {
        // Toggle: none -> asc -> desc -> none
        if (gCurrentSortOrder === 'none') gCurrentSortOrder = 'asc';
        else if (gCurrentSortOrder === 'asc') gCurrentSortOrder = 'desc';
        else gCurrentSortOrder = 'none';
    } else {
        gCurrentSortKey = key;
        gCurrentSortOrder = 'asc';
    }
    
    // Reset all headers state
    document.querySelectorAll(".sortable-header").forEach(th => {
        th.classList.remove("active-sort");
        const icon = th.querySelector(".sort-icon");
        if (icon) {
            icon.className = "fa-solid fa-sort sort-icon";
        }
    });
    
    // Set active header state
    if (gCurrentSortOrder !== 'none') {
        thEl.classList.add("active-sort");
        const icon = thEl.querySelector(".sort-icon");
        if (icon) {
            if (gCurrentSortOrder === 'asc') {
                icon.className = "fa-solid fa-sort-up sort-icon";
            } else {
                icon.className = "fa-solid fa-sort-down sort-icon";
            }
        }
    }
    
    renderDEGTable();
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
    const statType = document.getElementById("stat-type") ? document.getElementById("stat-type").value : "fdr";
    
    // Sort logic
    let sortedGenes = [...gGenes];
    if (gCurrentSortKey && gCurrentSortOrder !== 'none') {
        const key = gCurrentSortKey;
        const order = gCurrentSortOrder === 'asc' ? 1 : -1;
        
        sortedGenes.sort((a, b) => {
            let valA, valB;
            
            if (key === "classification") {
                const getClassification = (gene) => {
                    const statVal = statType === "fdr" ? gene.fdr : gene.pvalue;
                    const passesLog2FC = Math.abs(gene.log2fc) >= log2fcThresh;
                    let passesPVal = true;
                    if (statType !== "none" && gIsReplicateMode) {
                        passesPVal = (statVal !== null && statVal <= pvalThresh);
                    }
                    if (passesLog2FC && passesPVal) {
                        if (gene.log2fc >= log2fcThresh) return "Upregulated";
                        if (gene.log2fc <= -log2fcThresh) return "Downregulated";
                    }
                    return "Neutral";
                };
                valA = getClassification(a);
                valB = getClassification(b);
            } else {
                valA = a[key];
                valB = b[key];
            }
            
            if (valA === null || valA === undefined) return 1;
            if (valB === null || valB === undefined) return -1;
            
            if (typeof valA === "string") {
                return order * valA.localeCompare(valB);
            } else {
                return order * (valA - valB);
            }
        });
    } else {
        // Fallback to original order
        sortedGenes.sort((a, b) => (a.original_index || 0) - (b.original_index || 0));
    }
    
    sortedGenes.forEach(gene => {
        const symbol = gene.gene_symbol.toLowerCase();
        const locus = gene.locus_tag.toLowerCase();
        
        // Search filter
        if (searchVal && !symbol.includes(searchVal) && !locus.includes(searchVal)) {
            return;
        }
        
        // Determine DEG classification
        let classification = "Neutral";
        let classClass = "";
        
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
        margin: { t: 20, r: 20, b: 65, l: 60 },
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

// Global IGV Browser instance holder
let gIgvBrowserInstance = null;

function openGeneIGVModal(gene) {
    const modal = document.getElementById("gene-modal");
    if (!modal) return;
    
    document.getElementById("modal-gene-title").textContent = `${gene.gene_symbol} (${gene.locus_tag})`;
    document.getElementById("modal-gene-desc").textContent = gene.description || '유전자 설명이 존재하지 않습니다.';
    
    modal.style.display = "flex";
    
    // Bind Close events
    const closeBtn = document.getElementById("close-modal");
    if (closeBtn) {
        closeBtn.onclick = () => {
            modal.style.display = "none";
        };
    }
    window.onclick = (e) => {
        if (e.target === modal) {
            modal.style.display = "none";
        }
    };
    
    // Render a copy of the bar chart inside the modal
    setTimeout(() => {
        let trace1, trace2;
        if (gIsReplicateMode && gene.wt_reps && gene.mut_reps) {
            trace1 = {
                x: ['WT', 'Mutant'],
                y: [gene.wt_val, gene.mutant_val],
                type: 'bar',
                name: '평균값',
                marker: { color: ['rgba(99, 102, 241, 0.4)', 'rgba(239, 68, 68, 0.4)'] }
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
                marker: { size: 10, color: ['#6366f1', '#6366f1', '#6366f1', '#ff4d4d', '#ff4d4d', '#ff4d4d'], opacity: 0.9 }
            };
        } else {
            trace1 = {
                x: ['WT', 'Mutant'],
                y: [gene.wt_val, gene.mutant_val],
                type: 'bar',
                marker: { color: ['#6366f1', '#ff4d4d'] }
            };
        }
        const layout = {
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            font: { color: '#0f172a', family: 'Inter, sans-serif' },
            xaxis: { gridcolor: '#e2e8f0' },
            yaxis: { title: 'Expression Value', gridcolor: '#e2e8f0' },
            margin: { t: 20, r: 10, b: 30, l: 50 },
            showlegend: false,
            height: 220
        };
        Plotly.newPlot('modal-chart', trace2 ? [trace1, trace2] : [trace1], layout, {responsive: true});
    }, 100);
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
    const chartDiv = document.getElementById("plotly-heatmap");
    
    const heightInput = document.getElementById("heatmap-height");
    const heatmapHeight = heightInput ? parseInt(heightInput.value) : 600;
    if (chartDiv) {
        chartDiv.style.height = `${heatmapHeight}px`;
    }
    
    const gapInput = document.getElementById("heatmap-dendro-gap");
    const gapRatio = gapInput ? parseFloat(gapInput.value) / 100.0 : 0.02;
    
    const gapTopInput = document.getElementById("heatmap-dendro-gap-top");
    const gapRatioTop = gapTopInput ? parseFloat(gapTopInput.value) / 100.0 : 0.02;
    
    const marginBotInput = document.getElementById("heatmap-margin-bottom");
    const marginBot = marginBotInput ? parseInt(marginBotInput.value) : 100;
    
    if (!applyClustering) {
        // Simple mock hierarchical clustering for layout (Local mode)
        let sorted = [...gGenes];
        if (metric === "log2fc") {
            sorted.sort((a, b) => Math.abs(b.log2fc) - Math.abs(a.log2fc));
        } else {
            sorted = sorted.filter(g => g.fdr !== null);
            sorted.sort((a, b) => a.fdr - b.fdr);
        }
        
        const topGenes = sorted.slice(0, count);
        
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
            
            const allVals = [...wtVals, ...mutVals];
            const mean = npMean(allVals);
            const std = npStd(allVals) || 1.0;
            
            zDataWT.push(wtVals.map(v => (v - mean) / std));
            zDataMutant.push(mutVals.map(v => (v - mean) / std));
        });
        
        let wtCount = zDataWT[0].length;
        let mutCount = zDataMutant[0].length;
        
        // 1. Build original sample candidates map
        const samplesList = [];
        for (let i = 0; i < wtCount; i++) {
            samplesList.push({ name: wtCount > 1 ? `WT_Rep${i+1}` : 'WT', type: 'wt', localIdx: i });
        }
        for (let i = 0; i < mutCount; i++) {
            samplesList.push({ name: mutCount > 1 ? `Mutant_Rep${i+1}` : 'Mutant', type: 'mutant', localIdx: i });
        }
        
        // 2. Perform sorting logic based on dropdown choices
        const orderTypeSelect = document.getElementById("heatmap-sample-order-type");
        const orderType = orderTypeSelect ? orderTypeSelect.value : "wt-mutant";
        
        let orderedSamples = [];
        if (orderType === "wt-mutant") {
            orderedSamples = [...samplesList];
        } else if (orderType === "mutant-wt") {
            orderedSamples = [
                ...samplesList.filter(s => s.type === 'mutant'),
                ...samplesList.filter(s => s.type === 'wt')
            ];
        } else if (orderType === "custom") {
            const customInput = document.getElementById("heatmap-sample-order-custom");
            const customVal = customInput ? customInput.value : "";
            const customNames = customVal.split(",").map(s => s.trim().toUpperCase()).filter(s => s !== "");
            
            customNames.forEach(cName => {
                const found = samplesList.find(s => s.name.toUpperCase() === cName);
                if (found && !orderedSamples.includes(found)) {
                    orderedSamples.push(found);
                }
            });
            
            // Append missing samples safely to prevent data loss
            samplesList.forEach(s => {
                if (!orderedSamples.includes(s)) {
                    orderedSamples.push(s);
                }
            });
        } else {
            orderedSamples = [...samplesList];
        }
        
        // 3. Assemble xLabels and zDataMatrix with the reordered samples
        const xLabels = orderedSamples.map(s => s.name);
        const zDataMatrix = [];
        
        for (let r = 0; r < yLabels.length; r++) {
            const rowWT = zDataWT[r];
            const rowMutant = zDataMutant[r];
            const reorderedRow = orderedSamples.map(s => {
                return s.type === 'wt' ? rowWT[s.localIdx] : rowMutant[s.localIdx];
            });
            zDataMatrix.push(reorderedRow);
        }
        
        const trace = {
            z: zDataMatrix,
            x: xLabels,
            y: yLabels,
            type: 'heatmap',
            colorscale: [
                [0, '#0000ff'],      // Deep Blue
                [0.5, '#ffffff'],    // White
                [1, '#ff0000']       // Deep Red
            ],
            colorbar: {
                title: 'Z-score',
                titleside: 'right'
            },
            hoverongaps: false
        };
        
        const layout = {
            height: heatmapHeight,
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            font: { color: '#0f172a', family: 'Inter, sans-serif' },
            margin: { t: 20, r: 20, b: marginBot, l: 150 },
            xaxis: { tickangle: -45 },
            yaxis: { autorange: 'reversed', showgrid: false }
        };
        
        Plotly.newPlot('plotly-heatmap', [trace], layout, {responsive: true});
    } else {
        // Advanced Hierarchical Clustering with Dendrograms (Server mode)
        chartDiv.innerHTML = `<div style="text-align: center; padding-top: 150px; color: #64748b;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><p style="margin-top: 10px;">이차원 계층 클러스터링(Heatmap & Dendrogram) 연산 중...</p></div>`;
        
        // Extract top genes based on criteria
        let sorted = [...gGenes];
        if (metric === "log2fc") {
            sorted.sort((a, b) => Math.abs(b.log2fc) - Math.abs(a.log2fc));
        } else {
            sorted = sorted.filter(g => g.fdr !== null);
            sorted.sort((a, b) => a.fdr - b.fdr);
        }
        const topGenes = sorted.slice(0, count);
        const geneLocusTags = topGenes.map(g => g.locus_tag);

        fetch(`${API_URL}/api/cluster_heatmap`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                genes: geneLocusTags,
                count: count,
                metric: metric
            })
        })
        .then(r => r.json())
        .then(data => {
            if (!data.success) {
                chartDiv.innerHTML = `<div class="text-center text-danger" style="padding-top: 150px;">클러스터링 연산 실패: ${data.detail}</div>`;
                return;
            }
            
            const xLabels = data.x_labels || [];
            const yLabels = data.y_labels || [];
            const zMatrix = data.expression_matrix || [];
            const geneDendro = data.gene_dendrogram;
            const sampleDendro = data.sample_dendrogram;
            
            const traces = [];
            
            // Generate index arrays for linear scale matching
            const xIndices = xLabels.map((_, i) => i);
            const yIndices = yLabels.map((_, i) => i);
            
            // 1. Heatmap Trace
            const heatmapTrace = {
                z: zMatrix,
                x: xIndices,
                y: yIndices,
                type: 'heatmap',
                xaxis: 'x',
                yaxis: 'y',
                colorscale: [
                    [0, '#0000ff'],
                    [0.5, '#ffffff'],
                    [1, '#ff0000']
                ],
                colorbar: {
                    title: 'Z-score',
                    titleside: 'right',
                    len: 0.8,
                    y: 0.4
                },
                hoverongaps: false
            };
            traces.push(heatmapTrace);
            
            // 2. Gene Dendrogram Trace (Y-axis hierarchy)
            if (geneDendro && geneDendro.x && geneDendro.x.length > 0) {
                const gdX = [];
                const gdY = [];
                geneDendro.x.forEach((xs, idx) => {
                    const ys = geneDendro.y[idx];
                    gdX.push(...xs, null);
                    gdY.push(...ys, null);
                });
                
                const geneDendroTrace = {
                    x: gdX,
                    y: gdY,
                    type: 'scatter',
                    mode: 'lines',
                    xaxis: 'x2',
                    yaxis: 'y',
                    line: { color: '#475569', width: 1.5 },
                    hoverinfo: 'none',
                    showlegend: false
                };
                traces.push(geneDendroTrace);
            }
            
            // 3. Sample Dendrogram Trace (X-axis hierarchy)
            if (sampleDendro && sampleDendro.x && sampleDendro.x.length > 0) {
                const sdX = [];
                const sdY = [];
                sampleDendro.x.forEach((xs, idx) => {
                    const ys = sampleDendro.y[idx];
                    sdX.push(...xs, null);
                    sdY.push(...ys, null);
                });
                
                const sampleDendroTrace = {
                    x: sdX,
                    y: sdY,
                    type: 'scatter',
                    mode: 'lines',
                    xaxis: 'x',
                    yaxis: 'y2',
                    line: { color: '#475569', width: 1.5 },
                    hoverinfo: 'none',
                    showlegend: false
                };
                traces.push(sampleDendroTrace);
            }
            
            // Calculate dynamic margins and domain boundaries based on gapRatio, gapRatioTop, and marginBot
            const gap = gapRatio;
            
            // X-axis layouts:
            // xaxis (heatmap): [0.24, 1.0]
            // xaxis2 (gene dendrogram): [0.0, 0.24 - gap]
            const xHeatmapStart = 0.24;
            const xGeneDendroEnd = Math.max(0.0, xHeatmapStart - gap);
            
            // Y-axis layouts:
            // yaxis (heatmap): [0.0, 0.82]
            // yaxis2 (sample dendrogram): [0.82 + gapRatioTop, 1.0]
            const yHeatmapEnd = 0.82;
            const ySampleDendroStart = Math.min(1.0, yHeatmapEnd + gapRatioTop);

            const layout = {
                height: heatmapHeight,
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor: 'rgba(0,0,0,0)',
                font: { color: '#0f172a', family: 'Inter, sans-serif' },
                margin: { t: 10, r: 20, b: marginBot, l: 150 },
                showlegend: false,
                
                // Axis configurations for subplot domain partitioning
                xaxis: {
                    domain: [xHeatmapStart, 1.0],
                    tickangle: -45,
                    showgrid: false,
                    zeroline: false,
                    tickvals: xIndices,
                    ticktext: xLabels
                },
                yaxis: {
                    domain: [0.0, yHeatmapEnd],
                    autorange: 'reversed',
                    showgrid: false,
                    zeroline: false,
                    tickvals: yIndices,
                    ticktext: yLabels
                },
                
                // X2 is for Gene Dendrogram (Left side)
                xaxis2: {
                    domain: [0.0, xGeneDendroEnd],
                    showgrid: false,
                    zeroline: false,
                    showticklabels: false,
                    autorange: 'reversed' // Branch outwards towards the left
                },
                
                // Y2 is for Sample Dendrogram (Top side)
                yaxis2: {
                    domain: [ySampleDendroStart, 1.0],
                    showgrid: false,
                    zeroline: false,
                    showticklabels: false
                }
            };
            
            chartDiv.innerHTML = "";
            Plotly.newPlot('plotly-heatmap', traces, layout, {responsive: true});
        })
        .catch(err => {
            console.error("Clustering API 오류:", err);
            chartDiv.innerHTML = `<div class="text-center text-danger" style="padding-top: 150px;"><i class="fa-solid fa-triangle-exclamation fa-2x mb-10"></i><p>클러스터링 로드 실패: ${err.message}</p></div>`;
        });
    }
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
            
            // Clear input search term on fetch new dataset
            const searchInput = document.getElementById("kegg-search-gene");
            if (searchInput) searchInput.value = "";
            
            renderPathwayList("");
        })
        .catch(err => {
            listEl.innerHTML = `<li class="loading-item text-danger">실패: ${err.message}</li>`;
        });
}

function renderPathwayList(keyword) {
    const listEl = document.getElementById("kegg-pathway-list");
    listEl.innerHTML = "";
    
    if (!gPathwayList || gPathwayList.length === 0) {
        listEl.innerHTML = '<li class="loading-item text-muted">경로 데이터가 없습니다.</li>';
        return;
    }
    
    const searchVal = keyword.trim().toUpperCase();
    const filtered = gPathwayList.filter(path => {
        if (!searchVal) return true;
        // Search by Pathway ID or description
        if (path.pathway_id.toUpperCase().includes(searchVal) || path.description.toUpperCase().includes(searchVal)) {
            return true;
        }
        // Search by contained gene symbols or locus_tags
        if (path.search_genes && path.search_genes.some(g => g.includes(searchVal))) {
            return true;
        }
        return false;
    });
    
    if (filtered.length === 0) {
        listEl.innerHTML = '<li class="loading-item text-muted">검색 조건에 맞는 경로가 없습니다.</li>';
        return;
    }
    
    filtered.forEach(path => {
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
                
                // Check if current search query matches this node
                const searchInput = document.getElementById("kegg-search-gene");
                const currentQuery = searchInput ? searchInput.value.trim().toUpperCase() : "";
                
                let isMatched = false;
                if (currentQuery) {
                    const genesList = area.gene.toUpperCase().split("+");
                    if (genesList.some(g => g === currentQuery)) {
                        isMatched = true;
                    }
                    if (area.title && area.title.toUpperCase().includes(currentQuery)) {
                        isMatched = true;
                    }
                    
                    // Support check by related genes from full dataset
                    const matchedGeneInData = gGenes.find(g => 
                        g.locus_tag.toUpperCase() === currentQuery || 
                        g.gene_symbol.toUpperCase() === currentQuery
                    );
                    if (matchedGeneInData) {
                        const targetLocus = matchedGeneInData.locus_tag.toUpperCase();
                        const targetSymbol = matchedGeneInData.gene_symbol.toUpperCase();
                        if (genesList.some(g => g === targetLocus || g === targetSymbol) ||
                            (area.title && (area.title.toUpperCase().includes(targetLocus) || area.title.toUpperCase().includes(targetSymbol)))) {
                            isMatched = true;
                        }
                    }
                }
                
                if (isMatched) {
                    overlay.classList.add("highlight-active");
                }
                
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
                showGeneDetails(match);
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
    openGeneIGVModal(gene);
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
// 11. STRING PPI & TF-Target Regulatory Network Graph
// ----------------------------------------------------------------------
let cyInstance = null;
let gNetworkMode = 'string'; // 'string' or 'tf'
let gTFAssociationData = null; // Stored results from TF enrichment

function renderNetworkGraph() {
    const limit = document.getElementById("network-limit").value;
    const score = document.getElementById("network-score").value;
    const container = document.getElementById("cy-network");
    
    if (gNetworkMode === 'string') {
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
    } else {
        // TF-Target Regulatory Network Mode
        container.innerHTML = `<div style="text-align: center; padding-top: 200px; color: #64748b;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><p style="margin-top: 10px;">전사인자(TF) 조절 관계 연산 및 초기하 검정 중...</p></div>`;
        const tfListContainer = document.getElementById("network-tf-list-container");
        if (tfListContainer) {
            tfListContainer.innerHTML = `<div style="text-align: center; padding-top: 80px; color: #64748b;"><i class="fa-solid fa-spinner fa-spin"></i><p style="font-size: 12px; margin-top: 6px;">TF 목록 집계 중...</p></div>`;
        }

        // Calculate targetList based on current threshold
        const log2fcThresh = parseFloat(document.getElementById("log2fc-thresh").value) || 0;
        const pvalThresh = parseFloat(document.getElementById("pvalue-thresh").value) || 1.0;
        const statType = document.getElementById("stat-type") ? document.getElementById("stat-type").value : "fdr";
        const targetList = [];
        gGenes.forEach(gene => {
            const statVal = statType === "fdr" ? gene.fdr : gene.pvalue;
            const passesLog2FC = Math.abs(gene.log2fc) >= log2fcThresh;
            let passesPVal = true;
            if (statType !== "none" && gIsReplicateMode) {
                passesPVal = (statVal !== null && statVal <= pvalThresh);
            }
            if (passesLog2FC && passesPVal) {
                targetList.push(gene.locus_tag);
            }
        });

        // Use selectedTfId if provided or default TF (e.g. YEL009C)
        const activeTfRow = document.querySelector(".tf-row.selected-tf-row");
        const selectedTfParam = activeTfRow ? activeTfRow.getAttribute("data-tf-id") : "YEL009C";

        fetch(`${API_URL}/api/tf_enrichment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                genes: targetList,
                selected_tf: selectedTfParam
            })
        })
        .then(r => r.json())
        .then(data => {
            if (data.success === false) {
                container.innerHTML = `<div class="text-center text-danger" style="padding-top: 200px;"><i class="fa-solid fa-circle-exclamation fa-2x mb-10"></i><p>TF 분석 실패: ${data.detail || "알 수 없는 에러"}</p></div>`;
                return;
            }
            
            gTFAssociationData = data.enrichment || [];
            
            // 1. Render TF Enrichment Table in the Right Subtab
            renderTFListTable(gTFAssociationData, selectedTfParam);
            
            // 2. Render Full Regulatory Network
            const network = data.network || { nodes: [], edges: [] };
            const nodes = network.nodes || [];
            const edges = network.edges || [];
            
            if (nodes.length === 0) {
                container.innerHTML = `<div class="text-center text-muted" style="padding-top: 200px;">규제 네트워크를 렌더링할 유의미한 TF-Target 관계가 없습니다.</div>`;
                return;
            }
            
            container.innerHTML = "";
            const elements = [];
            
            nodes.forEach(n => {
                let color = '#cbd5e1';
                let shape = 'ellipse';
                let borderCol = '#1e293b';
                
                if (n.is_tf) {
                    shape = 'hexagon';
                    color = '#818cf8'; // Premium indigo for TFs
                    borderCol = '#4f46e5';
                } else {
                    if (n.log2fc > 0) {
                        const intensity = Math.min(n.log2fc / 2.0, 1.0);
                        color = `rgb(${255}, ${Math.round(255 - 200 * intensity)}, ${Math.round(255 - 200 * intensity)})`;
                    } else if (n.log2fc < 0) {
                        const intensity = Math.min(Math.abs(n.log2fc) / 2.0, 1.0);
                        color = `rgb(${Math.round(255 - 200 * intensity)}, ${Math.round(255 - 200 * intensity)}, ${255})`;
                    }
                }
                
                elements.push({
                    data: {
                        id: n.id,
                        label: n.label,
                        log2fc: n.log2fc || 0,
                        is_tf: n.is_tf,
                        desc: n.desc || '',
                        bg: color,
                        shape: shape,
                        border: borderCol
                    }
                });
            });
            
            edges.forEach((e, idx) => {
                elements.push({
                    data: {
                        id: `tf_e_${idx}`,
                        source: e.source,
                        target: e.target,
                        type: e.type || 'regulate'
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
                            'shape': 'data(shape)',
                            'border-width': '2.5px',
                            'border-color': 'data(border)',
                            'color': '#0f172a',
                            'font-size': '11px',
                            'font-weight': 'bold',
                            'text-valign': 'center',
                            'text-halign': 'center',
                            'width': '48px',
                            'height': '48px',
                            'text-outline-width': '1.5px',
                            'text-outline-color': '#ffffff'
                        }
                    },
                    {
                        selector: 'edge',
                        style: {
                            'width': '2px',
                            'line-color': '#a5b4fc',
                            'target-arrow-color': '#4f46e5',
                            'target-arrow-shape': 'triangle', // Clarifies regulatory flow directions (TF -> Target)
                            'curve-style': 'bezier',
                            'opacity': 0.85
                        }
                    }
                ],
                layout: {
                    name: 'cose',
                    animate: true,
                    nodeRepulsion: function( node ){ return 3000; },
                    idealEdgeLength: function( edge ){ return 80; },
                    fit: true
                }
            });
            
            // Node Tap Listener
            const detailsPanel = document.getElementById("network-node-details");
            cyInstance.on('tap', 'node', function(evt){
                const nodeData = evt.target.data();
                
                // Switch to detail subtab
                document.getElementById("btn-subtab-node").click();
                
                detailsPanel.innerHTML = `
                    <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 12px; margin-bottom: 12px;">
                        <span style="font-size: 11px; font-weight: 600; color: #6366f1; text-transform: uppercase;">
                            ${nodeData.is_tf ? 'Transcription Factor (TF)' : 'Target DEG Gene'}
                        </span>
                        <h5 style="font-size: 16px; font-weight: 700; color: #0f172a; margin: 2px 0;">${nodeData.id}</h5>
                    </div>
                    <div style="margin-bottom: 10px;">
                        <span style="font-size: 11px; font-weight: 600; color: #64748b;">Gene Symbol</span>
                        <p style="font-size: 14px; font-weight: 500; color: #1e293b; margin: 2px 0;">${nodeData.label}</p>
                    </div>
                    ${!nodeData.is_tf ? `
                    <div style="margin-bottom: 10px;">
                        <span style="font-size: 11px; font-weight: 600; color: #64748b;">Log2 Fold Change</span>
                        <p style="font-size: 14px; font-weight: 600; color: ${nodeData.log2fc >= 0 ? '#ef4444' : '#3b82f6'}; margin: 2px 0;">
                            ${nodeData.log2fc >= 0 ? '+' : ''}${nodeData.log2fc.toFixed(4)}
                        </p>
                    </div>` : ''}
                    <div>
                        <span style="font-size: 11px; font-weight: 600; color: #64748b;">Description</span>
                        <p style="font-size: 13px; line-height: 1.5; color: #475569; margin: 2px 0; max-height: 200px; overflow-y: auto;">
                            ${nodeData.desc || '설명 정보 없음'}
                        </p>
                    </div>
                `;
            });
        })
        .catch(err => {
            console.error("TF Network 렌더링 실패:", err);
            container.innerHTML = `<div class="text-center text-danger" style="padding-top: 200px;"><i class="fa-solid fa-circle-exclamation fa-2x mb-10"></i><p>네트워크 렌더링 실패: ${err.message}</p></div>`;
        });
    }
}

function renderTFListTable(tfResults, activeTfId) {
    const container = document.getElementById("network-tf-list-container");
    if (!container) return;
    
    if (tfResults.length === 0) {
        container.innerHTML = `<p class="text-center text-muted" style="padding: 20px 0;">농축된 전사인자(TF)가 존재하지 않습니다.</p>`;
        return;
    }
    
    let html = `
        <div class="table-responsive" style="max-height: 520px; overflow-y: auto;">
            <table class="data-table" style="font-size: 11px; width: 100%;">
                <thead>
                    <tr>
                        <th>TF</th>
                        <th class="stat-header">매치 (k/M)</th>
                        <th class="stat-header">p-value</th>
                        <th class="stat-header">FDR</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    tfResults.forEach(r => {
        const isSelected = r.tf_id === activeTfId;
        const rowStyle = isSelected ? "background: rgba(99, 102, 241, 0.15); font-weight: bold;" : "";
        const rowClass = isSelected ? "tf-row selected-tf-row" : "tf-row";
        
        html += `
            <tr class="${rowClass}" data-tf-id="${r.tf_id}" data-tf-name="${r.tf_name}" style="cursor: pointer; ${rowStyle}">
                <td><strong>${r.tf_name}</strong></td>
                <td class="text-center">${r.k} / ${r.M}</td>
                <td class="text-right">${r.pvalue.toExponential(3)}</td>
                <td class="text-right">${r.fdr.toExponential(3)}</td>
            </tr>
        `;
    });
    
    html += `
                </tbody>
            </table>
        </div>
    `;
    
    container.innerHTML = html;
    
    // Add Row Click Event to fetch network for specific TF
    container.querySelectorAll(".tf-row").forEach(row => {
        row.addEventListener("click", () => {
            const tfId = row.getAttribute("data-tf-id");
            
            // Update selected indicator classes
            container.querySelectorAll(".tf-row").forEach(r => {
                r.classList.remove("selected-tf-row");
                r.style.background = "";
                r.style.fontWeight = "normal";
            });
            row.classList.add("selected-tf-row");
            row.style.background = "rgba(99, 102, 241, 0.15)";
            row.style.fontWeight = "bold";
            
            // Re-render Cytoscape network focused on this TF
            renderNetworkGraph();
        });
    });
}

function highlightTFInNetwork(tfName) {
    if (!cyInstance) return;
    
    cyInstance.batch(() => {
        // 1. Reset styles
        cyInstance.nodes().style({
            'opacity': 0.25,
            'border-color': '#cbd5e1'
        });
        cyInstance.edges().style({
            'opacity': 0.1,
            'line-color': '#e2e8f0'
        });
        
        // 2. Find TF node
        const tfNode = cyInstance.getElementById(tfName);
        if (tfNode.length > 0) {
            tfNode.style({
                'opacity': 1.0,
                'border-color': '#4f46e5',
                'border-width': '4px',
                'width': '65px',
                'height': '65px'
            });
            
            // 3. Find connected targets and edges
            const connectedEdges = tfNode.connectedEdges();
            connectedEdges.style({
                'opacity': 1.0,
                'line-color': '#4f46e5',
                'width': '3.5px'
            });
            
            connectedEdges.targets().style({
                'opacity': 1.0,
                'border-color': '#1e293b',
                'border-width': '2.5px'
            });
            
            // Pan and zoom to TF node and targets
            cyInstance.animate({
                fit: {
                    eles: tfNode.union(connectedEdges.targets()),
                    padding: 50
                },
                duration: 500
            });
        } else {
            // TF is not in network viewport, reset to show all
            cyInstance.nodes().style('opacity', 1.0);
            cyInstance.edges().style('opacity', 0.85);
            cyInstance.fit();
            alert(`전사인자 "${tfName}"가 현재 가시 노드 내에 포함되어 있지 않습니다.`);
        }
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

// ----------------------------------------------------------------------
// 10. Data & Visual Chart Export Helpers (Excel, JPG, PDF)
// ----------------------------------------------------------------------
function exportPlotlyChart(elementId, format, filename) {
    const gd = document.getElementById(elementId);
    if (!gd || !gd.data || gd.data.length === 0) {
        alert("내보낼 차트 데이터가 존재하지 않습니다.");
        return;
    }
    
    // Deep copy original layout properties to restore them later
    const originalLayout = JSON.parse(JSON.stringify(gd.layout));
    
    // Create a temporary light-theme-friendly layout for high-quality publication export
    const exportLayout = {
        ...gd.layout,
        paper_bgcolor: '#ffffff',
        plot_bgcolor: '#ffffff'
    };
    
    // Force title font color to be dark
    if (exportLayout.title) {
        if (typeof exportLayout.title === 'string') {
            exportLayout.title = { text: exportLayout.title, font: { color: '#0f172a' } };
        } else {
            exportLayout.title = {
                ...exportLayout.title,
                font: exportLayout.title.font ? { ...exportLayout.title.font, color: '#0f172a' } : { color: '#0f172a' }
            };
        }
    }
    
    // Force general font color to dark grey
    if (exportLayout.font) {
        exportLayout.font = { ...exportLayout.font, color: '#1e293b' };
    } else {
        exportLayout.font = { color: '#1e293b' };
    }
    
    // Adjust X axis colors (dark labels and grid lines)
    if (exportLayout.xaxis) {
        exportLayout.xaxis = {
            ...exportLayout.xaxis,
            gridcolor: '#e2e8f0',
            zerolinecolor: '#cbd5e1',
            tickfont: exportLayout.xaxis.tickfont ? { ...exportLayout.xaxis.tickfont, color: '#334155' } : { color: '#334155' },
            title: exportLayout.xaxis.title ? (typeof exportLayout.xaxis.title === 'string' ? { text: exportLayout.xaxis.title, font: { color: '#0f172a' } } : { ...exportLayout.xaxis.title, font: { color: '#0f172a', ...exportLayout.xaxis.title.font } }) : undefined
        };
    }
    
    // Adjust Y axis colors (dark labels and grid lines)
    if (exportLayout.yaxis) {
        exportLayout.yaxis = {
            ...exportLayout.yaxis,
            gridcolor: '#e2e8f0',
            zerolinecolor: '#cbd5e1',
            tickfont: exportLayout.yaxis.tickfont ? { ...exportLayout.yaxis.tickfont, color: '#334155' } : { color: '#334155' },
            title: exportLayout.yaxis.title ? (typeof exportLayout.yaxis.title === 'string' ? { text: exportLayout.yaxis.title, font: { color: '#0f172a' } } : { ...exportLayout.yaxis.title, font: { color: '#0f172a', ...exportLayout.yaxis.title.font } }) : undefined
        };
    }
    
    // Adjust Legend fonts
    if (exportLayout.legend) {
        exportLayout.legend = {
            ...exportLayout.legend,
            font: exportLayout.legend.font ? { ...exportLayout.legend.font, color: '#1e293b' } : { color: '#1e293b' }
        };
    }
    
    // Temporarily apply the light layout, capture the image, and revert
    Plotly.relayout(gd, exportLayout).then(() => {
        if (format === 'jpeg') {
            Plotly.downloadImage(gd, {
                format: 'jpeg',
                filename: filename,
                width: 1200,
                height: 800,
                setBackground: '#ffffff'
            }).then(() => {
                Plotly.relayout(gd, originalLayout);
            }).catch(err => {
                Plotly.relayout(gd, originalLayout);
                console.error(err);
            });
        } else if (format === 'pdf') {
            Plotly.toImage(gd, {
                format: 'jpeg',
                width: 1200,
                height: 800,
                quality: 1,
                setBackground: '#ffffff'
            }).then(dataUrl => {
                const { jsPDF } = window.jspdf;
                const pdf = new jsPDF('landscape', 'px', [1200, 800]);
                pdf.addImage(dataUrl, 'JPEG', 0, 0, 1200, 800);
                pdf.save(`${filename}.pdf`);
                Plotly.relayout(gd, originalLayout);
            }).catch(err => {
                Plotly.relayout(gd, originalLayout);
                console.error(err);
                alert("PDF 생성 중 오류가 발생했습니다: " + err.message);
            });
        }
    });
}

function exportKeggMap(format, filename) {
    const container = document.getElementById("kegg-map-container");
    const wrapper = container.querySelector(".kegg-image-wrapper");
    if (!wrapper) {
        alert("선택 및 로드된 KEGG Pathway 지도가 없습니다.");
        return;
    }
    
    // Save original inline styles to restore after capture
    const originalWidthStyle = wrapper.style.width;
    const originalHeightStyle = wrapper.style.height;
    const originalOverflowStyle = wrapper.style.overflow;
    
    // Get full scrollable/renderable dimensions of the pathway map
    const fullWidth = wrapper.scrollWidth;
    const fullHeight = wrapper.scrollHeight;
    
    // Temporarily force wrapper size to fit the entire map to prevent clipping
    wrapper.style.width = `${fullWidth}px`;
    wrapper.style.height = `${fullHeight}px`;
    wrapper.style.overflow = "visible";
    
    html2canvas(wrapper, {
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        width: fullWidth,
        height: fullHeight,
        scrollX: 0,
        scrollY: 0,
        x: 0,
        y: 0,
        scale: 2 // Double scale for high-definition publication resolution
    }).then(canvas => {
        // Restore styles immediately
        wrapper.style.width = originalWidthStyle;
        wrapper.style.height = originalHeightStyle;
        wrapper.style.overflow = originalOverflowStyle;
        
        if (format === 'jpeg') {
            const link = document.createElement("a");
            link.download = `${filename}.jpg`;
            link.href = canvas.toDataURL("image/jpeg", 0.95);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } else if (format === 'pdf') {
            const imgData = canvas.toDataURL("image/jpeg", 1.0);
            const imgWidth = canvas.width / 2; // Compensate scale: 2
            const imgHeight = canvas.height / 2;
            
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF(imgWidth > imgHeight ? 'l' : 'p', 'px', [imgWidth, imgHeight]);
            pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight);
            pdf.save(`${filename}.pdf`);
        }
    }).catch(err => {
        // Restore styles on error
        wrapper.style.width = originalWidthStyle;
        wrapper.style.height = originalHeightStyle;
        wrapper.style.overflow = originalOverflowStyle;
        console.error(err);
        alert("KEGG 지도 캡처 및 내보내기 실패: " + err.message);
    });
}

// ----------------------------------------------------------------------
// 13. Promoter Sequence Motif Discovery
// ----------------------------------------------------------------------
function renderMotifLogoPlaceholder() {
    const chartDiv = document.getElementById("motif-logo-chart");
    if (!chartDiv) return;
    
    chartDiv.innerHTML = `
        <div class="text-center text-muted" style="padding: 100px 0;">
            <i class="fa-solid fa-wand-magic-sparkles fa-3x mb-15" style="color: #cbd5e1;"></i>
            <p style="font-size: 14px; font-weight: 500;">상단 '모티프 분석 실행' 버튼을 눌러 프로모터 모티프를 도출하세요.</p>
        </div>
    `;
    
    document.getElementById("motif-consensus-text").textContent = "N/A";
    document.getElementById("motif-score-text").textContent = "N/A";
}

function runMotifAnalysis() {
    if (gGenes.length === 0) {
        alert("분석할 유전자 발현 데이터가 없습니다. 먼저 데이터를 로드해 주세요.");
        return;
    }
    
    const chartDiv = document.getElementById("motif-logo-chart");
    const lenSelect = document.getElementById("motif-len-select");
    const motifLen = lenSelect ? lenSelect.value : 8;
    
    chartDiv.innerHTML = `
        <div style="text-align: center; padding-top: 150px; color: #64748b;">
            <i class="fa-solid fa-spinner fa-spin fa-2x"></i>
            <p style="margin-top: 10px; font-weight: 500;">프로모터 서열 획득 및 Gibbs Sampling 모티프 연산 중...</p>
        </div>
    `;
    
    // Calculate targetList based on current threshold
    const log2fcThresh = parseFloat(document.getElementById("log2fc-thresh").value) || 0;
    const pvalThresh = parseFloat(document.getElementById("pvalue-thresh").value) || 1.0;
    const statType = document.getElementById("stat-type") ? document.getElementById("stat-type").value : "fdr";
    const targetList = [];
    gGenes.forEach(gene => {
        const statVal = statType === "fdr" ? gene.fdr : gene.pvalue;
        const passesLog2FC = Math.abs(gene.log2fc) >= log2fcThresh;
        let passesPVal = true;
        if (statType !== "none" && gIsReplicateMode) {
            passesPVal = (statVal !== null && statVal <= pvalThresh);
        }
        if (passesLog2FC && passesPVal) {
            targetList.push(gene.locus_tag);
        }
    });

    if (targetList.length === 0) {
        chartDiv.innerHTML = `
            <div class="text-center text-warning" style="padding-top: 150px;">
                <i class="fa-solid fa-triangle-exclamation fa-2x mb-10"></i>
                <p>현재 필터 기준에 부합하는 유효한 DEG 유전자가 없습니다.<br>상단 필터 설정을 조정하여 유의미한 유전자를 확보해 주세요.</p>
            </div>
        `;
        return;
    }
    
    fetch(`${API_URL}/api/motif_discovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            genes: targetList,
            motif_len: parseInt(motifLen)
        })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success === false || !data.consensus) {
            chartDiv.innerHTML = `
                <div class="text-center text-danger" style="padding-top: 150px;">
                    <i class="fa-solid fa-circle-exclamation fa-2x mb-10"></i>
                    <p>모티프 분석 실패: ${data.detail || "서열 정보가 부족합니다."}</p>
                </div>
            `;
            return;
        }
        
        // Update summary text
        document.getElementById("motif-consensus-text").textContent = data.consensus || "N/A";
        document.getElementById("motif-score-text").textContent = `${data.score ? data.score.toFixed(3) : "0"} bits`;
        
        // Draw Sequence Logo stacked bar chart
        const logoData = data.logo || [];
        if (logoData.length === 0) {
            chartDiv.innerHTML = `<div class="text-center text-muted" style="padding-top: 150px;">모티프 데이터가 비어 있습니다.</div>`;
            return;
        }
        
        // Prepare arrays for Plotly traces
        const positions = logoData.map(d => `Pos ${d.position}`);
        const bitsA = logoData.map(d => d.heights ? d.heights.A || 0.0 : 0.0);
        const bitsC = logoData.map(d => d.heights ? d.heights.C || 0.0 : 0.0);
        const bitsG = logoData.map(d => d.heights ? d.heights.G || 0.0 : 0.0);
        const bitsT = logoData.map(d => d.heights ? d.heights.T || 0.0 : 0.0);
        
        // Trace A (Emerald Green)
        const traceA = {
            x: positions,
            y: bitsA,
            name: 'A',
            type: 'bar',
            marker: { color: '#10b981' },
            hovertemplate: 'Position %{x}<br>A: %{y:.3f} bits<extra></extra>'
        };
        
        // Trace C (Blue)
        const traceC = {
            x: positions,
            y: bitsC,
            name: 'C',
            type: 'bar',
            marker: { color: '#3b82f6' },
            hovertemplate: 'Position %{x}<br>C: %{y:.3f} bits<extra></extra>'
        };
        
        // Trace G (Orange/Amber)
        const traceG = {
            x: positions,
            y: bitsG,
            name: 'G',
            type: 'bar',
            marker: { color: '#f59e0b' },
            hovertemplate: 'Position %{x}<br>G: %{y:.3f} bits<extra></extra>'
        };
        
        // Trace T (Red)
        const traceT = {
            x: positions,
            y: bitsT,
            name: 'T',
            type: 'bar',
            marker: { color: '#ef4444' },
            hovertemplate: 'Position %{x}<br>T: %{y:.3f} bits<extra></extra>'
        };
        
        const layout = {
            title: {
                text: `Promoter Consensus Motif: "${data.consensus}" (Length: ${motifLen} bp)`,
                font: { size: 16, color: '#0f172a', family: 'Inter, sans-serif' }
            },
            xaxis: {
                title: 'Sequence Position (5\' -> 3\')',
                tickfont: { size: 12, color: '#475569' }
            },
            yaxis: {
                title: 'Information Content (Bits)',
                gridcolor: '#e2e8f0',
                range: [0, 2.1], // Maximum information content for DNA is 2 bits
                tickfont: { size: 12, color: '#475569' }
            },
            barmode: 'stack', // Stacked bars mock the sequence logo
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            margin: { l: 60, r: 20, t: 60, b: 60 },
            legend: {
                orientation: 'h',
                yanchor: 'bottom',
                y: 1.02,
                xanchor: 'right',
                x: 1
            }
        };
        
        chartDiv.innerHTML = "";
        Plotly.newPlot('motif-logo-chart', [traceT, traceG, traceC, traceA], layout, {responsive: true});
    })
    .catch(err => {
        console.error("Motif 분석 중 오류 발생:", err);
        chartDiv.innerHTML = `
            <div class="text-center text-danger" style="padding-top: 150px;">
                <i class="fa-solid fa-circle-exclamation fa-2x mb-10"></i>
                <p>모티프 분석 오류: ${err.message}</p>
            </div>
        `;
    });
}

// ----------------------------------------------------------------------
// 10. Advanced Strain Analysis Integration
// ----------------------------------------------------------------------
function initAdvancedAnalysisBindings() {
    // Subtab toggles
    const subtabTfBtn = document.getElementById("btn-subtab-tf");
    const subtabBottleneckBtn = document.getElementById("btn-subtab-bottleneck");
    const subtabStressBtn = document.getElementById("btn-subtab-stress");
    const subtabReporterBtn = document.getElementById("btn-subtab-reporter");

    const tfArea = document.getElementById("subtab-tf-area");
    const bottleneckArea = document.getElementById("subtab-bottleneck-area");
    const stressArea = document.getElementById("subtab-stress-area");
    const reporterArea = document.getElementById("subtab-reporter-area");

    const resetSubtabs = () => {
        [subtabTfBtn, subtabBottleneckBtn, subtabStressBtn, subtabReporterBtn].forEach(btn => {
            if (btn) {
                btn.classList.remove("active");
                btn.style.color = "var(--text-muted)";
                btn.style.borderColor = "var(--border-color)";
            }
        });
        [tfArea, bottleneckArea, stressArea, reporterArea].forEach(area => {
            if (area) area.style.display = "none";
        });
    };

    if (subtabTfBtn) {
        subtabTfBtn.addEventListener("click", () => {
            resetSubtabs();
            subtabTfBtn.classList.add("active");
            subtabTfBtn.style.color = "var(--text-primary)";
            subtabTfBtn.style.borderColor = "var(--primary-color)";
            if (tfArea) tfArea.style.display = "block";
        });
    }

    if (subtabBottleneckBtn) {
        subtabBottleneckBtn.addEventListener("click", () => {
            resetSubtabs();
            subtabBottleneckBtn.classList.add("active");
            subtabBottleneckBtn.style.color = "var(--text-primary)";
            subtabBottleneckBtn.style.borderColor = "var(--primary-color)";
            if (bottleneckArea) bottleneckArea.style.display = "block";
            populateBottleneckPathwayDropdown();
        });
    }

    if (subtabStressBtn) {
        subtabStressBtn.addEventListener("click", () => {
            resetSubtabs();
            subtabStressBtn.classList.add("active");
            subtabStressBtn.style.color = "var(--text-primary)";
            subtabStressBtn.style.borderColor = "var(--primary-color)";
            if (stressArea) stressArea.style.display = "block";
        });
    }

    if (subtabReporterBtn) {
        subtabReporterBtn.addEventListener("click", () => {
            resetSubtabs();
            subtabReporterBtn.classList.add("active");
            subtabReporterBtn.style.color = "var(--text-primary)";
            subtabReporterBtn.style.borderColor = "var(--primary-color)";
            if (reporterArea) reporterArea.style.display = "block";
        });
    }

    // Action button listeners
    const btnRunTf = document.getElementById("btn-run-tf-analysis");
    if (btnRunTf) btnRunTf.addEventListener("click", runTFActivityAnalysis);

    const btnRunBottleneck = document.getElementById("btn-run-bottleneck");
    if (btnRunBottleneck) btnRunBottleneck.addEventListener("click", runMetabolicBottleneckScan);

    const btnRunStress = document.getElementById("btn-run-stress-prediction");
    if (btnRunStress) btnRunStress.addEventListener("click", runStressSpectrumPrediction);

    const btnRunReporter = document.getElementById("btn-run-reporter");
    if (btnRunReporter) btnRunReporter.addEventListener("click", runReporterMetaboliteAnalysis);

    // Toggle WT / Mutant traces in stress radar chart
    const btnToggleWT = document.getElementById("btn-stress-toggle-wt");
    const btnToggleMut = document.getElementById("btn-stress-toggle-mut");

    if (btnToggleWT) {
        btnToggleWT.addEventListener("click", () => {
            btnToggleWT.classList.toggle("active");
            renderStressRadarChart();
        });
    }

    if (btnToggleMut) {
        btnToggleMut.addEventListener("click", () => {
            btnToggleMut.classList.toggle("active");
            renderStressRadarChart();
        });
    }
}

// 1) TF Activity Analysis
function runTFActivityAnalysis() {
    const chartDiv = document.getElementById("tf-activity-chart");
    chartDiv.innerHTML = `<div style="text-align:center; padding-top:150px; color:#64748b;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><p style="margin-top:10px;">전사인자 활성 추론 계산 중...</p></div>`;

    fetch(`${API_URL}/api/tf_activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
    })
    .then(res => {
        if (!res.ok) throw new Error("TF 분석 API 실패");
        return res.json();
    })
    .then(data => {
        if (!data.success || data.results.length === 0) {
            chartDiv.innerHTML = `<div style="text-align:center; padding-top:150px; color:#ef4444;">유의한 전사인자 표적 농축 결과를 도출하지 못했습니다.</div>`;
            return;
        }

        const results = data.results;
        const tfNames = results.map(r => r.tf);
        const scores = results.map(r => r.score);
        const colors = scores.map(s => s >= 0 ? 'rgba(99, 102, 241, 0.85)' : 'rgba(239, 68, 68, 0.85)');

        const trace = {
            x: scores,
            y: tfNames,
            type: 'bar',
            orientation: 'h',
            marker: {
                color: colors,
                line: { color: 'rgba(0, 0, 0, 0.1)', width: 1 }
            },
            text: scores.map(s => `${s >= 0 ? '+' : ''}${s}`),
            textposition: 'auto',
            customdata: results
        };

        const layout = {
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            xaxis: {
                title: '활성 활성화도 지수 (PSRS Score)',
                gridcolor: '#e2e8f0',
                zerolinecolor: '#cbd5e1'
            },
            yaxis: {
                autorange: 'reversed',
                gridcolor: '#e2e8f0'
            },
            margin: { l: 80, r: 30, t: 10, b: 60 }
        };

        chartDiv.innerHTML = "";
        const myPlot = document.createElement("div");
        myPlot.style.width = "100%";
        myPlot.style.height = "100%";
        chartDiv.appendChild(myPlot);

        Plotly.newPlot(myPlot, [trace], layout, {responsive: true});

        myPlot.on('plotly_click', function(clickData) {
            const point = clickData.points[0];
            const tfData = point.customdata;
            displayTfTargetDEGs(tfData);
        });

        displayTfTargetDEGs(results[0]);
    })
    .catch(err => {
        console.error(err);
        chartDiv.innerHTML = `<div style="text-align:center; padding-top:150px; color:#ef4444;">오류 발생: ${err.message}</div>`;
    });
}

function displayTfTargetDEGs(tfData) {
    document.getElementById("tf-selected-desc").innerHTML = `
        <strong>${tfData.tf}</strong>: ${tfData.description}<br>
        <span class="text-muted" style="font-size:11px;">P-value: ${tfData.p_value.toExponential(3)} | 상태: <span style="font-weight:bold; color:${tfData.state==='Activated'?'#4f46e5':'#dc2626'}">${tfData.state}</span></span>
    `;

    const container = document.getElementById("tf-target-list-container");
    container.innerHTML = "";

    if (tfData.target_degs.length === 0) {
        container.innerHTML = `<div style="text-align:center; color:#94a3b8; padding-top:40px; font-size:12px;">유의미한 표적 발현 유전자(DEG)가 존재하지 않습니다.</div>`;
        return;
    }

    tfData.target_degs.forEach(sym => {
        const row = document.createElement("div");
        row.className = "tf-gene-row";
        
        const matched = gGenes.find(g => g.gene_symbol.toUpperCase() === sym.toUpperCase());
        const log2fc = matched ? matched.log2fc : 0.0;
        const colorClass = log2fc >= 0 ? "up-text" : "down-text";

        row.innerHTML = `
            <span><strong>${sym}</strong></span>
            <span class="${colorClass}" style="font-weight:bold;">${log2fc > 0 ? '+' : ''}${log2fc} Log2FC</span>
        `;
        container.appendChild(row);
    });
}

// 2) Metabolic Bottleneck Scan
function populateBottleneckPathwayDropdown() {
    const select = document.getElementById("bottleneck-pathway-select");
    if (!select) return;
    if (select.children.length > 0) return;

    fetch(`${API_URL}/api/pathways`)
    .then(res => res.json())
    .then(data => {
        select.innerHTML = "";
        data.pathways.forEach(path => {
            const opt = document.createElement("option");
            opt.value = path.pathway_id;
            opt.textContent = `${path.pathway_id.replace("path:", "")} - ${path.description.length > 25 ? path.description.substring(0, 25) + '...' : path.description}`;
            select.appendChild(opt);
        });
    })
    .catch(err => console.error("KEGG 목록 로드 실패:", err));
}

function runMetabolicBottleneckScan() {
    const select = document.getElementById("bottleneck-pathway-select");
    if (!select) return;
    const pathwayId = select.value;

    const tbody = document.getElementById("bottleneck-table-body");
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:50px 0;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><p style="margin-top:10px;">대사 경로 병목 지점 스캔 중...</p></td></tr>`;

    fetch(`${API_URL}/api/metabolic_bottleneck`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pathway_id: pathwayId })
    })
    .then(res => {
        if (!res.ok) throw new Error("병목 분석 API 실패");
        return res.json();
    })
    .then(data => {
        tbody.innerHTML = "";
        if (!data.success || data.candidates.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#64748b; padding:40px 0;">본 경로에는 임계 범위 내에 걸려있는 병목 의심 유전자가 검출되지 않았습니다.</td></tr>`;
            return;
        }

        data.candidates.forEach(cand => {
            const row = document.createElement("tr");
            const classSeverity = cand.severity === "High" ? "severity-high" : "severity-medium";
            
            row.innerHTML = `
                <td><code>${cand.locus_tag}</code></td>
                <td><strong>${cand.gene_symbol}</strong></td>
                <td>${cand.wt_val}</td>
                <td>${cand.mutant_val}</td>
                <td class="${cand.log2fc >= 0 ? 'up-text' : 'down-text'}">${cand.log2fc > 0 ? '+' : ''}${cand.log2fc}</td>
                <td style="color:#475569; font-size:12px;">${cand.reason}</td>
                <td><span class="${classSeverity}">${cand.severity}</span></td>
                <td style="font-size:12px; color:#1e293b; line-height:1.4;">${cand.guide}</td>
            `;
            tbody.appendChild(row);
        });
    })
    .catch(err => {
        console.error(err);
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#ef4444; padding:40px 0;">분석 실패: ${err.message}</td></tr>`;
    });
}

// 3) Stress Spectrum Prediction (Radar Chart)
let gLastStressData = null;

function runStressSpectrumPrediction() {
    const chartDiv = document.getElementById("stress-radar-chart");
    chartDiv.innerHTML = `<div style="text-align:center; padding-top:130px; color:#64748b;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><p style="margin-top:10px;">스트레스 저항성 판정 연산 중...</p></div>`;

    const reportContainer = document.getElementById("stress-report-container");
    reportContainer.innerHTML = "";

    fetch(`${API_URL}/api/stress_prediction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
    })
    .then(res => {
        if (!res.ok) throw new Error("스트레스 분석 API 실패");
        return res.json();
    })
    .then(data => {
        if (!data.success || data.profiles.length === 0) {
            chartDiv.innerHTML = `<div style="text-align:center; padding-top:130px; color:#ef4444;">유효한 매칭 데이터를 확보하지 못했습니다.</div>`;
            return;
        }

        gLastStressData = data.profiles;
        
        // Render Chart based on toggles
        renderStressRadarChart();

        // Render Report
        data.profiles.forEach(p => {
            const card = document.createElement("div");
            card.style.border = "1px solid var(--border-color)";
            card.style.borderRadius = "8px";
            card.style.padding = "12px";
            card.style.background = "#ffffff";
            
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <strong>${p.name}</strong>
                    <span class="${p.class_name}">${p.status} (PSRS: ${p.score})</span>
                </div>
                <p style="font-size:12px; color:#475569; line-height:1.4; margin-bottom:0;">${p.verdict}</p>
            `;
            reportContainer.appendChild(card);
        });
    })
    .catch(err => {
        console.error(err);
        chartDiv.innerHTML = `<div style="text-align:center; padding-top:130px; color:#ef4444;">오류: ${err.message}</div>`;
    });
}

function renderStressRadarChart() {
    const chartDiv = document.getElementById("stress-radar-chart");
    if (!gLastStressData || gLastStressData.length === 0) return;

    const btnWT = document.getElementById("btn-stress-toggle-wt");
    const btnMut = document.getElementById("btn-stress-toggle-mut");

    const showWT = btnWT ? btnWT.classList.contains("active") : true;
    const showMut = btnMut ? btnMut.classList.contains("active") : true;

    // Styles update based on active class
    if (btnWT) {
        if (showWT) {
            btnWT.style.background = "#fef2f2";
            btnWT.style.color = "#dc2626";
            btnWT.style.borderColor = "#fca5a5";
        } else {
            btnWT.style.background = "#ffffff";
            btnWT.style.color = "var(--text-muted)";
            btnWT.style.borderColor = "var(--border-color)";
        }
    }
    if (btnMut) {
        if (showMut) {
            btnMut.style.background = "#e0e7ff";
            btnMut.style.color = "#4f46e5";
            btnMut.style.borderColor = "#a5b4fc";
        } else {
            btnMut.style.background = "#ffffff";
            btnMut.style.color = "var(--text-muted)";
            btnMut.style.borderColor = "var(--border-color)";
        }
    }

    const thetaVals = gLastStressData.map(p => p.name);
    thetaVals.push(thetaVals[0]); // circular wrap-around

    const traces = [];

    // 1) Wild-Type Trace (Red)
    if (showWT) {
        const wtScores = Array(gLastStressData.length + 1).fill(0.0);
        traces.push({
            type: 'scatterpolar',
            r: wtScores,
            theta: thetaVals,
            name: '야생형 (WT)',
            fill: 'toself',
            fillcolor: 'rgba(239, 68, 68, 0.12)',
            line: { color: 'rgba(239, 68, 68, 0.85)', width: 2 },
            marker: { size: 6 }
        });
    }

    // 2) Mutant Trace (Indigo/Blue)
    if (showMut) {
        const mutScores = gLastStressData.map(p => p.score);
        mutScores.push(mutScores[0]);
        traces.push({
            type: 'scatterpolar',
            r: mutScores,
            theta: thetaVals,
            name: '변이주 (Mutant)',
            fill: 'toself',
            fillcolor: 'rgba(99, 102, 241, 0.12)',
            line: { color: 'rgba(99, 102, 241, 0.85)', width: 2 },
            marker: { size: 6 }
        });
    }

    const layout = {
        polar: {
            radialaxis: {
                visible: true,
                range: [-10, 10],
                gridcolor: '#e2e8f0',
                zerolinecolor: '#cbd5e1'
            },
            angularaxis: {
                gridcolor: '#e2e8f0'
            }
        },
        paper_bgcolor: 'rgba(0,0,0,0)',
        margin: { l: 45, r: 45, t: 30, b: 30 },
        showlegend: false
    };

    chartDiv.innerHTML = "";
    const myPlot = document.createElement("div");
    myPlot.style.width = "100%";
    myPlot.style.height = "100%";
    chartDiv.appendChild(myPlot);

    Plotly.newPlot(myPlot, traces, layout, {responsive: true});
}

// 4) Reporter Metabolites Analysis
function runReporterMetaboliteAnalysis() {
    const chartDiv = document.getElementById("reporter-score-chart");
    chartDiv.innerHTML = `<div style="text-align:center; padding-top:150px; color:#64748b;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><p style="margin-top:10px;">리포터 대사물질 스캔 중...</p></div>`;

    fetch(`${API_URL}/api/reporter_metabolites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
    })
    .then(res => {
        if (!res.ok) throw new Error("리포터 분석 API 실패");
        return res.json();
    })
    .then(data => {
        if (!data.success || data.results.length === 0) {
            chartDiv.innerHTML = `<div style="text-align:center; padding-top:150px; color:#ef4444;">유의한 리포터 대사물질을 탐지하지 못했습니다.</div>`;
            return;
        }

        const results = data.results;
        // Take top 15 metabolites for better readability
        const topResults = results.slice(0, 15);
        const metNames = topResults.map(r => `${r.name} (${r.compartment})`);
        const scores = topResults.map(r => r.score);
        
        // Dynamic colors based on significance score (threshold 1.5)
        const colors = scores.map(s => s >= 1.5 ? 'rgba(139, 92, 246, 0.85)' : 'rgba(148, 163, 184, 0.85)');

        const trace = {
            x: scores,
            y: metNames,
            type: 'bar',
            orientation: 'h',
            marker: {
                color: colors,
                line: { color: 'rgba(0, 0, 0, 0.1)', width: 1 }
            },
            text: scores.map(s => `${s}`),
            textposition: 'auto',
            customdata: topResults
        };

        const layout = {
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            xaxis: {
                title: 'Reporter Score (Z-score)',
                gridcolor: '#e2e8f0',
                zerolinecolor: '#cbd5e1'
            },
            yaxis: {
                autorange: 'reversed',
                gridcolor: '#e2e8f0'
            },
            margin: { l: 150, r: 30, t: 10, b: 60 }
        };

        chartDiv.innerHTML = "";
        const myPlot = document.createElement("div");
        myPlot.style.width = "100%";
        myPlot.style.height = "100%";
        chartDiv.appendChild(myPlot);

        Plotly.newPlot(myPlot, [trace], layout, {responsive: true});

        myPlot.on('plotly_click', function(clickData) {
            const point = clickData.points[0];
            const metData = point.customdata;
            displayReporterDetailTable(metData);
        });

        // Default load the first one
        displayReporterDetailTable(topResults[0]);
    })
    .catch(err => {
        console.error(err);
        chartDiv.innerHTML = `<div style="text-align:center; padding-top:150px; color:#ef4444;">오류 발생: ${err.message}</div>`;
    });
}

function displayReporterDetailTable(metData) {
    const desc = document.getElementById("reporter-selected-desc");
    const body = document.getElementById("reporter-detail-body");

    if (!metData) {
        desc.textContent = "조회된 데이터가 없습니다.";
        body.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #94a3b8; padding: 40px 0;">조회된 상세 정보가 없습니다.</td></tr>`;
        return;
    }

    // Compartment class matching
    let compClass = 'badge-comp-cytosol';
    if (metData.compartment === 'mitochondria') {
        compClass = 'badge-comp-mitochondria';
    } else if (metData.compartment === 'extracellular') {
        compClass = 'badge-comp-extracellular';
    }

    desc.innerHTML = `선택된 대사물질: <strong>${metData.name}</strong> <span class="badge-compartment ${compClass}">${metData.compartment}</span> (연관 유전자: ${metData.gene_count}개)`;

    body.innerHTML = "";
    metData.genes.forEach(g => {
        const fc = parseFloat(g.log2fc).toFixed(3);
        const pVal = parseFloat(g.p_value).toExponential(3);
        
        let fcColor = 'var(--text-primary)';
        if (g.log2fc >= 0.8) fcColor = 'var(--up-red)';
        else if (g.log2fc <= -0.8) fcColor = 'var(--down-blue)';

        const tr = document.createElement("tr");
        tr.style.borderBottom = "1px solid var(--border-color)";
        tr.innerHTML = `
            <td style="padding: 8px; font-weight: 600;">${g.gene_symbol}</td>
            <td style="padding: 8px; color: #64748b;">${g.locus_tag}</td>
            <td style="padding: 8px; text-align: right; color: ${fcColor}; font-weight: 500;">${g.log2fc >= 0 ? '+' : ''}${fc}</td>
            <td style="padding: 8px; text-align: right; color: #64748b;">${pVal}</td>
        `;
        body.appendChild(tr);
    });
}

// Custom GSH Pathway Mapped Overlay & Interactive Editor Logic
// ----------------------------------------------------------------------
let pathwayMapsStore = {};
let currentMapId = "yeast_gsh_pathway";
let isGshEditMode = false;
let activeGshTool = null; // 'add-node', 'add-arrow', 'add-gene', 'delete', null
let selectedArrowSourceId = null;

// Global selection sets for advanced editor UX
let selectedNodes = new Set();
let selectedArrows = new Set();
let selectedGenes = new Set(); // Stores gene symbol names (keys)
let clipboardBuffer = null; // Buffer containing deep copies of copied elements

function getGshGeneOffsets(mapId) {
    const map = pathwayMapsStore[mapId];
    if (!map) return {};
    if (!map.geneOffsets) {
        const local = localStorage.getItem(`gsh_gene_offsets_${mapId}`);
        map.geneOffsets = local ? JSON.parse(local) : {};
    }
    return map.geneOffsets;
}

function setGshGeneOffsets(mapId, val) {
    const map = pathwayMapsStore[mapId];
    if (map) {
        map.geneOffsets = val;
        localStorage.setItem(`gsh_gene_offsets_${mapId}`, JSON.stringify(val));
    }
}

function getGshCustomGenes(mapId) {
    const map = pathwayMapsStore[mapId];
    if (!map) return [];
    if (!map.customGenes) {
        const local = localStorage.getItem(`gsh_custom_genes_${mapId}`);
        map.customGenes = local ? JSON.parse(local) : [];
    }
    return map.customGenes;
}

function setGshCustomGenes(mapId, val) {
    const map = pathwayMapsStore[mapId];
    if (map) {
        map.customGenes = val;
        localStorage.setItem(`gsh_custom_genes_${mapId}`, JSON.stringify(val));
    }
}

function getGshDeletedDefaultGenes(mapId) {
    const map = pathwayMapsStore[mapId];
    if (!map) return [];
    if (!map.deletedDefaultGenes) {
        const local = localStorage.getItem(`gsh_deleted_default_genes_${mapId}`);
        map.deletedDefaultGenes = local ? JSON.parse(local) : [];
    }
    return map.deletedDefaultGenes;
}

function setGshDeletedDefaultGenes(mapId, val) {
    const map = pathwayMapsStore[mapId];
    if (map) {
        map.deletedDefaultGenes = val;
        localStorage.setItem(`gsh_deleted_default_genes_${mapId}`, JSON.stringify(val));
    }
}

function removeGshGeneData(mapId) {
    const map = pathwayMapsStore[mapId];
    if (map) {
        delete map.geneOffsets;
        delete map.customGenes;
        delete map.deletedDefaultGenes;
    }
    localStorage.removeItem(`gsh_gene_offsets_${mapId}`);
    localStorage.removeItem(`gsh_custom_genes_${mapId}`);
    localStorage.removeItem(`gsh_deleted_default_genes_${mapId}`);
}

function clearSelection() {
    selectedNodes.clear();
    selectedArrows.clear();
    selectedGenes.clear();
}

function saveAllPathwayMaps() {
    localStorage.setItem("pathway_maps_store", JSON.stringify(pathwayMapsStore));
    
    // Backup pathway maps to the server
    fetch(`${API_URL}/api/pathway_maps`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(pathwayMapsStore)
    })
    .then(res => res.json())
    .then(data => {
        if (!data.success) {
            console.error("Server pathway backup failed:", data.message);
        }
    })
    .catch(err => {
        console.error("Error backing up pathways to server:", err);
    });
}

function loadGSHPathwayData() {
    updateStatus("analyzing", "대사 경로 데이터 매핑 중...");
    
    // Fetch server backup to restore GSH & NMN maps
    fetch(`${API_URL}/api/pathway_maps`)
    .then(res => {
        if (!res.ok) throw new Error("Server backup API error");
        return res.json();
    })
    .then(serverData => {
        if (serverData.success && serverData.store) {
            pathwayMapsStore = serverData.store;
            localStorage.setItem("pathway_maps_store", JSON.stringify(pathwayMapsStore));
        } else {
            loadFromLocalStorage();
        }
        proceedWithLoading();
    })
    .catch(err => {
        console.warn("Failed to check server backup, using local fallback:", err);
        loadFromLocalStorage();
        proceedWithLoading();
    });

    function loadFromLocalStorage() {
        const savedStore = localStorage.getItem("pathway_maps_store");
        if (savedStore) {
            try {
                pathwayMapsStore = JSON.parse(savedStore);
            } catch (e) {
                console.error("Failed to parse saved pathway maps store:", e);
                pathwayMapsStore = {};
            }
        } else {
            pathwayMapsStore = {};
        }
    }

    function proceedWithLoading() {
        // Ensure default map exists in store
        if (!pathwayMapsStore["yeast_gsh_pathway"]) {
            fetchDefaultLayout()
            .then(defaultLayout => {
                pathwayMapsStore["yeast_gsh_pathway"] = {
                    name: "Yeast GSH Pathway",
                    width: defaultLayout.width || 1024,
                    height: defaultLayout.height || 580,
                    nodes: defaultLayout.nodes || [],
                    arrows: defaultLayout.arrows || []
                };
                saveAllPathwayMaps();
                initializeMapDropdown();
                selectAndLoadMap(currentMapId);
            })
            .catch(err => {
                console.error("Failed to load default layout:", err);
                updateStatus("ready", "분석 완료");
            });
            return;
        }
        
        initializeMapDropdown();
        selectAndLoadMap(currentMapId);
    }
}

function fetchDefaultLayout() {
    return fetch(`/data/gsh_pathway_layout.json`)
    .then(res => {
        if (!res.ok) throw new Error("Default layout file not found.");
        return res.json();
    });
}

function initializeMapDropdown() {
    const selectEl = document.getElementById("pathway-map-select");
    if (!selectEl) return;
    
    selectEl.innerHTML = "";
    Object.keys(pathwayMapsStore).forEach(mapId => {
        const option = document.createElement("option");
        option.value = mapId;
        option.textContent = pathwayMapsStore[mapId].name;
        if (mapId === currentMapId) {
            option.selected = true;
        }
        selectEl.appendChild(option);
    });
}

function selectAndLoadMap(mapId) {
    if (!pathwayMapsStore[mapId]) {
        mapId = "yeast_gsh_pathway";
    }
    currentMapId = mapId;
    clearSelection();
    
    const currentMap = pathwayMapsStore[currentMapId];
    
    // Update Size input forms
    const widthInput = document.getElementById("canvas-width-input");
    const heightInput = document.getElementById("canvas-height-input");
    if (widthInput) widthInput.value = currentMap.width || 1024;
    if (heightInput) heightInput.value = currentMap.height || 580;
    
    // Resize SVG viewport dynamically
    const svgEl = document.getElementById("gsh-pathway-svg");
    if (svgEl) {
        svgEl.setAttribute("viewBox", `0 0 ${currentMap.width || 1024} ${currentMap.height || 580}`);
        const bgRect = svgEl.querySelector("rect");
        if (bgRect) {
            bgRect.setAttribute("width", currentMap.width || 1024);
            bgRect.setAttribute("height", currentMap.height || 580);
        }
    }
    
    // Load gene expression mapping
    fetch(`${API_URL}/api/gsh_pathway_data`)
    .then(response => {
        if (!response.ok) throw new Error("GSH pathway data fetch failed.");
        return response.json();
    })
    .then(data => {
        if (data.success) {
            window.lastGSHResults = data.results;
            renderGSHPathway();
            updateStatus("ready", "분석 완료");
        } else {
            window.lastGSHResults = {};
            renderGSHPathway();
            updateStatus("ready", "분석 완료");
        }
    })
    .catch(err => {
        console.error("Failed to load map data:", err);
        window.lastGSHResults = {};
        renderGSHPathway();
        updateStatus("ready", "분석 완료");
    });
}

// Global reference mapping for fast lookup
function getNodesMap() {
    const map = {};
    const currentMap = pathwayMapsStore[currentMapId];
    if (currentMap && currentMap.nodes) {
        currentMap.nodes.forEach(n => {
            map[n.id] = n;
        });
    }
    return map;
}

// Calculate the optimized intersection path for arrows between nodes (Supports curves, straight lines, and free anchors)
function calculateArrowPath(arrow, nodesMap) {
    const fromNode = arrow.from ? nodesMap[arrow.from] : null;
    const toNode = arrow.to ? nodesMap[arrow.to] : null;
    
    // Core points
    let p1 = fromNode ? { x: fromNode.x + fromNode.w / 2, y: fromNode.y + fromNode.h / 2 } : (arrow.fromCoords || { x: 100, y: 100 });
    let p2 = toNode ? { x: toNode.x + toNode.w / 2, y: toNode.y + toNode.h / 2 } : (arrow.toCoords || { x: 200, y: 200 });
    
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist === 0) return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
    
    const ux = dx / dist;
    const uy = dy / dist;
    
    // Normal vector for parallel offsets (transverse shift)
    const nx = -uy;
    const ny = ux;
    
    const pOffset = arrow.parallelOffset || 0;
    
    // Shift core points parallel to the path line to avoid layout overlapping
    p1 = { x: p1.x + nx * pOffset, y: p1.y + ny * pOffset };
    p2 = { x: p2.x + nx * pOffset, y: p2.y + ny * pOffset };
    
    // Auto-calculate border offset boundary with clear margins to avoid overlapping arrowheads
    let startMargin = 2;
    let endMargin = 12;
    
    if (arrow.direction === 'both') {
        startMargin = 13;
        endMargin = 13;
    }
    
    let startX = fromNode ? p1.x + ux * (fromNode.w / 2 + startMargin) : p1.x + ux * startMargin;
    let startY = fromNode ? p1.y + uy * (fromNode.h / 2 + startMargin) : p1.y + uy * startMargin;
    
    const endX = toNode ? p2.x - ux * (toNode.w / 2 + endMargin) : p2.x - ux * endMargin;
    const endY = toNode ? p2.y - uy * (toNode.h / 2 + endMargin) : p2.y - uy * endMargin;
    
    // If straight line
    if (arrow.type !== 'curved') {
        return `M ${startX.toFixed(1)} ${startY.toFixed(1)} L ${endX.toFixed(1)} ${endY.toFixed(1)}`;
    }
    
    // If curved (quadratic bezier Q path)
    const mx = (startX + endX) / 2;
    const my = (startY + endY) / 2;
    const curvx = -uy;
    const curvy = ux;
    const curvature = arrow.curvature || 35;
    
    const cx = mx + curvx * curvature;
    const cy = my + curvy * curvature;
    
    return `M ${startX.toFixed(1)} ${startY.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${endX.toFixed(1)} ${endY.toFixed(1)}`;
}

// Comprehensive rendering function for both background template (nodes/arrows) and DEG overlay
function renderGSHPathway() {
    const nodesLayer = document.getElementById("gsh-pathway-nodes");
    const arrowsLayer = document.getElementById("gsh-pathway-arrows");
    const overlayLayer = document.getElementById("gsh-dynamic-overlay");
    const wrapper = document.querySelector(".gsh-pathway-wrapper");
    
    if (!nodesLayer || !arrowsLayer || !overlayLayer) return;
    
    // Clear previous
    nodesLayer.innerHTML = "";
    arrowsLayer.innerHTML = "";
    overlayLayer.innerHTML = "";
    
    // Toggle edit-mode body class
    if (isGshEditMode) {
        wrapper.classList.add("edit-mode-active");
    } else {
        wrapper.classList.remove("edit-mode-active");
    }
    
    const currentMap = pathwayMapsStore[currentMapId];
    if (!currentMap) return;
    
    const nodesMap = getNodesMap();
    
    // 1. Draw Arrows (Reaction connections)
    if (currentMap.arrows) {
        // Group arrows by their node endpoints (sorted to detect bidirectional and multi-links)
        const arrowGroups = {};
        currentMap.arrows.forEach(arrow => {
            if (arrow.from && arrow.to) {
                const key = [arrow.from, arrow.to].sort().join("___");
                if (!arrowGroups[key]) arrowGroups[key] = [];
                arrowGroups[key].push(arrow);
            }
        });

        currentMap.arrows.forEach(arrow => {
            // Auto-curve or Auto-shift overlapping arrows between same nodes
            let originalType = arrow.type;
            let originalCurvature = arrow.curvature;
            let originalParallelOffset = arrow.parallelOffset;
            
            if (arrow.from && arrow.to) {
                const key = [arrow.from, arrow.to].sort().join("___");
                const group = arrowGroups[key];
                if (group && group.length > 1) {
                    const index = group.indexOf(arrow);
                    const sortedNodes = [arrow.from, arrow.to].sort();
                    const isForward = arrow.from === sortedNodes[0];
                    
                    if (arrow.type === 'curved') {
                        // 곡선인 경우 엇갈리게 휨 (Auto-curve)
                        if (group.length === 2) {
                            arrow.curvature = isForward ? 24 : -24;
                        } else {
                            const step = 22;
                            const offset = (index - (group.length - 1) / 2) * step;
                            arrow.curvature = offset === 0 ? 12 : offset;
                        }
                    } else {
                        // 직선인 경우 나란하게 평행 시프트 (Auto-shift)
                        if (group.length === 2) {
                            arrow.parallelOffset = isForward ? 7 : -7;
                        } else {
                            const step = 10;
                            const offset = (index - (group.length - 1) / 2) * step;
                            arrow.parallelOffset = offset === 0 ? 5 : offset;
                        }
                    }
                }
            }
            
            const pathStr = calculateArrowPath(arrow, nodesMap);
            
            // Restore original object properties clean
            arrow.type = originalType;
            arrow.curvature = originalCurvature;
            arrow.parallelOffset = originalParallelOffset;
            
            if (!pathStr) return;
            
            const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
            
            // Apply selected class visually
            let arrowClass = "gsh-pathway-arrow-group";
            if (selectedArrows.has(arrow.id)) {
                arrowClass += " element-selected";
            }
            g.setAttribute("class", arrowClass);
            g.setAttribute("data-id", arrow.id);
            
            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("d", pathStr);
            
            // Set markers based on arrow direction
            if (arrow.direction === 'both') {
                path.setAttribute("marker-start", "url(#arrowhead-start)");
                path.setAttribute("marker-end", "url(#arrowhead)");
            } else {
                path.setAttribute("marker-end", "url(#arrowhead)");
            }
            
            path.setAttribute("stroke", "#64748b");
            path.setAttribute("stroke-width", "1.5");
            path.setAttribute("fill", "none");
            
            g.appendChild(path);
            
            // Edit mode listener for arrow
            if (isGshEditMode) {
                path.addEventListener("click", (e) => {
                    e.stopPropagation();
                    
                    if (activeGshTool === 'delete') {
                        if (confirm("이 반응 화살표를 삭제하시겠습니까?")) {
                            currentMap.arrows = currentMap.arrows.filter(a => a.id !== arrow.id);
                            selectedArrows.delete(arrow.id);
                            saveAllPathwayMaps();
                            renderGSHPathway();
                        }
                    } else if (!activeGshTool) {
                        // Toggle Selection
                        if (e.ctrlKey || e.shiftKey) {
                            if (selectedArrows.has(arrow.id)) selectedArrows.delete(arrow.id);
                            else selectedArrows.add(arrow.id);
                        } else {
                            clearSelection();
                            selectedArrows.add(arrow.id);
                        }
                        renderGSHPathway();
                    }
                });
            }
            
            // If arrow is selected and edit mode is active, render start & end anchor drag handles
            if (isGshEditMode && selectedArrows.has(arrow.id)) {
                const fromNode = arrow.from ? nodesMap[arrow.from] : null;
                const toNode = arrow.to ? nodesMap[arrow.to] : null;
                const pStart = arrow.fromCoords || (fromNode ? { x: fromNode.x + fromNode.w / 2, y: fromNode.y + fromNode.h / 2 } : { x: 100, y: 100 });
                const pEnd = arrow.toCoords || (toNode ? { x: toNode.x + toNode.w / 2, y: toNode.y + toNode.h / 2 } : { x: 200, y: 200 });
                
                const createAnchor = (pt, type) => {
                    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                    circle.setAttribute("cx", pt.x);
                    circle.setAttribute("cy", pt.y);
                    circle.setAttribute("r", "6");
                    circle.setAttribute("fill", type === 'start' ? "#3b82f6" : "#10b981");
                    circle.setAttribute("stroke", "#ffffff");
                    circle.setAttribute("stroke-width", "2");
                    circle.setAttribute("style", "cursor: pointer; pointer-events: auto;");
                    
                    circle.addEventListener("mousedown", (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (e.button !== 0) return;
                        
                        let isDraggingAnchor = true;
                        const startMouseX = e.clientX;
                        const startMouseY = e.clientY;
                        const startPtX = pt.x;
                        const startPtY = pt.y;
                        
                        const handleAnchorMove = (mvEvent) => {
                            if (!isDraggingAnchor) return;
                            const dx = mvEvent.clientX - startMouseX;
                            const dy = mvEvent.clientY - startMouseY;
                            
                            // Correct dx/dy relative to zoom scale
                            const correctedDx = dx / gshZoomScale;
                            const correctedDy = dy / gshZoomScale;
                            
                            const newX = Math.round(startPtX + correctedDx);
                            const newY = Math.round(startPtY + correctedDy);
                            
                            // Transform to absolute coordinate free arrow
                            arrow.from = null;
                            arrow.to = null;
                            
                            if (!arrow.fromCoords) arrow.fromCoords = { x: pStart.x, y: pStart.y };
                            if (!arrow.toCoords) arrow.toCoords = { x: pEnd.x, y: pEnd.y };
                            
                            if (type === 'start') {
                                arrow.fromCoords.x = newX;
                                arrow.fromCoords.y = newY;
                            } else {
                                arrow.toCoords.x = newX;
                                arrow.toCoords.y = newY;
                            }
                            
                            renderGSHPathway();
                        };
                        
                        const handleAnchorUp = () => {
                            isDraggingAnchor = false;
                            document.removeEventListener("mousemove", handleAnchorMove);
                            document.removeEventListener("mouseup", handleAnchorUp);
                            saveAllPathwayMaps();
                        };
                        
                        document.addEventListener("mousemove", handleAnchorMove);
                        document.addEventListener("mouseup", handleAnchorUp);
                    });
                    
                    g.appendChild(circle);
                };
                
                createAnchor(pStart, 'start');
                createAnchor(pEnd, 'end');
            }
            
            arrowsLayer.appendChild(g);
        });
    }
    
    // 2. Draw Metabolite Nodes
    if (currentMap.nodes) {
        currentMap.nodes.forEach(node => {
            const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
            
            // Selection highlights
            let nodeClass = "gsh-pathway-node-group";
            if (selectedNodes.has(node.id)) {
                nodeClass += " element-selected";
            }
            if (activeGshTool === 'add-arrow' && selectedArrowSourceId === node.id) {
                nodeClass += " node-connection-selected";
            }
            g.setAttribute("class", nodeClass);
            g.setAttribute("data-id", node.id);
            
            const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            rect.setAttribute("x", node.x);
            rect.setAttribute("y", node.y);
            rect.setAttribute("width", node.w);
            rect.setAttribute("height", node.h);
            rect.setAttribute("rx", node.rx || 12);
            rect.setAttribute("stroke-width", "1");
            rect.setAttribute("filter", "url(#shadow)");
            
            // Custom node color override or default types styling
            if (node.fillColor) {
                rect.setAttribute("fill", node.fillColor);
                rect.setAttribute("stroke", node.strokeColor || "#64748b");
                rect.setAttribute("stroke-width", "1.5");
            } else if (node.type === 'accent') {
                rect.setAttribute("fill", "#f1f5f9");
                rect.setAttribute("stroke", "#94a3b8");
                rect.setAttribute("stroke-width", "1.5");
            } else if (node.type === 'gsh') {
                rect.setAttribute("fill", "#ecfdf5");
                rect.setAttribute("stroke", "#10b981");
                rect.setAttribute("stroke-width", "1.5");
            } else if (node.type === 'gssg') {
                rect.setAttribute("fill", "#f0fdfa");
                rect.setAttribute("stroke", "#14b8a6");
                rect.setAttribute("stroke-width", "1.5");
            } else {
                rect.setAttribute("fill", "#ffffff");
                rect.setAttribute("stroke", "#cbd5e1");
                rect.setAttribute("stroke-width", "1");
            }
            
            const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
            text.setAttribute("x", node.x + node.w / 2);
            text.setAttribute("y", node.y + node.h / 2 + 4);
            text.setAttribute("font-size", node.id === 'aspartate_semiald' ? '10' : '11');
            text.textContent = node.label;
            
            if (node.textColor) {
                text.setAttribute("fill", node.textColor);
            } else if (node.type === 'gsh') {
                text.setAttribute("fill", "#065f46");
            } else if (node.type === 'gssg') {
                text.setAttribute("fill", "#0f766e");
            } else {
                text.setAttribute("fill", "#334155");
            }
            
            g.appendChild(rect);
            g.appendChild(text);
            
            // Edit Mode: Node Drag & Drop
            if (isGshEditMode) {
                let isDraggingNode = false;
                let startMux = 0;
                let startMuy = 0;
                
                g.addEventListener("mousedown", (e) => {
                    if (activeGshTool === 'add-arrow') return; // Let background canvas handle drag drawing!
                    
                    e.stopPropagation();
                    if (e.button !== 0) return; // Left click only
                    
                    // Click events mapping for tools
                    if (activeGshTool === 'delete') {
                        if (confirm(`대사산물 '${node.label}'만 삭제하시겠습니까? (연결된 화살표는 원래 자리에 보존됩니다)`)) {
                            // Backup coordinate pointers for any connected arrows before deleting this node
                            currentMap.arrows.forEach(arrow => {
                                if (arrow.from === node.id) {
                                    const pathStr = calculateArrowPath(arrow, nodesMap);
                                    const match = pathStr.match(/M\s+([\d.-]+)\s+([\d.-]+)/);
                                    if (match) {
                                        arrow.fromCoords = { x: parseFloat(match[1]), y: parseFloat(match[2]) };
                                    }
                                    arrow.from = null;
                                }
                                if (arrow.to === node.id) {
                                    const pathStr = calculateArrowPath(arrow, nodesMap);
                                    // Calculate target center coords fallback
                                    arrow.toCoords = { x: node.x + node.w / 2, y: node.y + node.h / 2 };
                                    arrow.to = null;
                                }
                            });
                            
                            currentMap.nodes = currentMap.nodes.filter(n => n.id !== node.id);
                            selectedNodes.delete(node.id);
                            saveAllPathwayMaps();
                            renderGSHPathway();
                        }
                        return;
                    }
                    
                    if (activeGshTool === 'add-arrow') {
                        if (!selectedArrowSourceId) {
                            selectedArrowSourceId = node.id;
                            renderGSHPathway();
                        } else if (selectedArrowSourceId === node.id) {
                            selectedArrowSourceId = null; // deselect
                            renderGSHPathway();
                        } else {
                            // Link Arrow from source to target
                            const selectedType = document.querySelector('input[name="arrow-type"]:checked')?.value || 'straight';
                            const selectedDir = document.querySelector('input[name="arrow-dir"]:checked')?.value || 'forward';
                            
                            const newArrow = {
                                id: `arr_${selectedArrowSourceId}_${node.id}_${Date.now()}`,
                                from: selectedArrowSourceId,
                                to: node.id,
                                type: selectedType,
                                direction: selectedDir
                            };
                            currentMap.arrows.push(newArrow);
                            selectedArrowSourceId = null;
                            saveAllPathwayMaps();
                            renderGSHPathway();
                        }
                        return;
                    }
                    
                    // Selection handling
                    if (!activeGshTool) {
                        if (e.ctrlKey || e.shiftKey) {
                            if (selectedNodes.has(node.id)) selectedNodes.delete(node.id);
                            else selectedNodes.add(node.id);
                        } else {
                            if (!selectedNodes.has(node.id)) {
                                clearSelection();
                                selectedNodes.add(node.id);
                            }
                        }
                        renderGSHPathway();
                    }
                    
                    // Default: Drag Node (Supports bulk dragging)
                    isDraggingNode = true;
                    startMux = e.clientX;
                    startMuy = e.clientY;
                    
                    // Capture start coordinates of all selected nodes for delta movement
                    const startCoords = {};
                    startCoords[node.id] = { x: node.x, y: node.y }; // Ensure current dragged node is always captured
                    selectedNodes.forEach(nid => {
                        const n = nodesMap[nid];
                        if (n) startCoords[nid] = { x: n.x, y: n.y };
                    });
                    
                    // Capture start offsets of all selected genes
                    const savedOffsets = getGshGeneOffsets(currentMapId);
                    const startOffsets = {};
                    selectedGenes.forEach(geneKey => {
                        startOffsets[geneKey] = JSON.parse(JSON.stringify(savedOffsets[geneKey] || { dx: 0, dy: 0 }));
                    });
                    
                    // Capture start coordinates of all selected arrows for delta movement
                    const startArrowCoords = {};
                    selectedArrows.forEach(aid => {
                        const arrow = currentMap.arrows.find(a => a.id === aid);
                        if (arrow) {
                            startArrowCoords[aid] = {
                                fromCoords: arrow.fromCoords ? { x: arrow.fromCoords.x, y: arrow.fromCoords.y } : null,
                                toCoords: arrow.toCoords ? { x: arrow.toCoords.x, y: arrow.toCoords.y } : null
                            };
                        }
                    });
                    
                    const handleMouseMove = (mvEvent) => {
                        if (!isDraggingNode) return;
                        
                        const deltaMux = mvEvent.clientX - startMux;
                        const deltaMuy = mvEvent.clientY - startMuy;
                        
                        const correctedDx = deltaMux / gshZoomScale;
                        const correctedDy = deltaMuy / gshZoomScale;
                        
                        // Bulk Move: if dragged node is part of selected nodes, move all. Otherwise move single.
                        if (selectedNodes.has(node.id)) {
                            selectedNodes.forEach(nid => {
                                const n = nodesMap[nid];
                                const sCoord = startCoords[nid];
                                if (n && sCoord) {
                                    n.x = sCoord.x + correctedDx;
                                    n.y = sCoord.y + correctedDy;
                                }
                            });
                            
                            // Also bulk move selected genes
                            selectedGenes.forEach(geneKey => {
                                const sOffset = startOffsets[geneKey];
                                if (sOffset) {
                                    savedOffsets[geneKey] = {
                                        dx: sOffset.dx + correctedDx,
                                        dy: sOffset.dy + correctedDy
                                    };
                                }
                            });
                            setGshGeneOffsets(currentMapId, savedOffsets);
                            
                            // Also bulk move selected arrows
                            selectedArrows.forEach(aid => {
                                const arrow = currentMap.arrows.find(a => a.id === aid);
                                const sArrowCoord = startArrowCoords[aid];
                                if (arrow && sArrowCoord) {
                                    if (arrow.fromCoords && sArrowCoord.fromCoords) {
                                        arrow.fromCoords.x = sArrowCoord.fromCoords.x + correctedDx;
                                        arrow.fromCoords.y = sArrowCoord.fromCoords.y + correctedDy;
                                    }
                                    if (arrow.toCoords && sArrowCoord.toCoords) {
                                        arrow.toCoords.x = sArrowCoord.toCoords.x + correctedDx;
                                        arrow.toCoords.y = sArrowCoord.toCoords.y + correctedDy;
                                    }
                                }
                            });
                        } else {
                            const sCoord = startCoords[node.id];
                            if (sCoord) {
                                node.x = sCoord.x + correctedDx;
                                node.y = sCoord.y + correctedDy;
                            }
                        }
                        
                        // Redraw pathway dynamically to update arrow paths and overlays cleanly
                        renderGSHPathway();
                    };
                    
                    const handleMouseUp = () => {
                        if (isDraggingNode) {
                            isDraggingNode = false;
                            saveAllPathwayMaps();
                            document.removeEventListener("mousemove", handleMouseMove);
                            document.removeEventListener("mouseup", handleMouseUp);
                            renderGSHPathway();
                        }
                    };
                    
                    document.addEventListener("mousemove", handleMouseMove);
                    document.addEventListener("mouseup", handleMouseUp);
                });
                
                // Double click to rename node name
                g.addEventListener("dblclick", (e) => {
                    e.stopPropagation();
                    const newLabel = prompt("대사산물 이름을 수정하세요:", node.label);
                    if (newLabel !== null && newLabel.trim() !== "") {
                        node.label = newLabel.trim();
                        saveAllPathwayMaps();
                        renderGSHPathway();
                    }
                });
            }
            
            nodesLayer.appendChild(g);
        });
    }
    
    // 3. Draw DEG Gene Overlays (Original overlay layer)
    try {
        renderGSHPathwayOverlay(window.lastGSHResults || {});
    } catch (e) {
        console.error("Error rendering GSH Pathway Overlay:", e);
    }
}
 
// Gene Deletion Helper
function deleteGeneElement(key) {
    let custom = getGshCustomGenes(currentMapId);
    const originLen = custom.length;
    custom = custom.filter(cg => cg.symbol !== key);
    setGshCustomGenes(currentMapId, custom);
    
    const offsets = getGshGeneOffsets(currentMapId);
    delete offsets[key];
    setGshGeneOffsets(currentMapId, offsets);
    
    if (originLen === custom.length) {
        const deletedDefaults = getGshDeletedDefaultGenes(currentMapId);
        deletedDefaults.push(key);
        setGshDeletedDefaultGenes(currentMapId, deletedDefaults);
    }
    
    selectedGenes.delete(key);
    loadGSHPathwayData();
}
 
function renderGSHPathwayOverlay(results) {
    const overlayLayer = document.getElementById("gsh-dynamic-overlay");
    if (!overlayLayer) return;
    
    // Clear previous boxes
    overlayLayer.innerHTML = "";
    
    let tooltip = document.getElementById("gsh-custom-tooltip");
    if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.id = "gsh-custom-tooltip";
        tooltip.className = "gsh-pathway-tooltip";
        tooltip.style.display = "none";
        document.body.appendChild(tooltip);
    }
    
    const currentMap = pathwayMapsStore[currentMapId];
    if (!currentMap) return;
    
    const mapWidth = currentMap.width || 1024;
    const mapHeight = currentMap.height || 580;
    
    // Convert to unified list of genes to render, resolving key collisions
    const genesToRender = [];
    const deletedDefaults = getGshDeletedDefaultGenes(currentMapId);
    const customGenes = getGshCustomGenes(currentMapId);
    const savedOffsets = getGshGeneOffsets(currentMapId);
    
    // 1. Add Default Genes if not deleted
    Object.keys(results).forEach(symbol => {
        if (!deletedDefaults.includes(symbol)) {
            const item = results[symbol];
            genesToRender.push({
                id: symbol, // defaults can use symbol as ID
                symbol: symbol,
                x: item.x,
                y: item.y,
                rep_log2fc: item.rep_log2fc || 0.0,
                genes: item.genes || [],
                isCustom: false
            });
        }
    });

    
    // 2. Add Custom Genes (Supports duplicates & key tracking)
    customGenes.forEach(cg => {
        const uniqueId = cg.id || `gene_legacy_${cg.symbol}_${Math.random()}`; // Handle old local storage models gracefully
        genesToRender.push({
            id: uniqueId,
            symbol: cg.symbol,
            x: cg.x,
            y: cg.y,
            rep_log2fc: cg.rep_log2fc || 0.0,
            genes: cg.genes || [],
            isCustom: true
        });
    });
    
    genesToRender.forEach(item => {
        const key = item.id; // unique id to track movements & selections
        const symbol = item.symbol;
        
        // Convert coords based on dynamic map dimensions
        const baseX = (item.x * mapWidth) / 100;
        const baseY = (item.y * mapHeight) / 100;
        
        const offset = savedOffsets[key] || { dx: 0, dy: 0 };
        const finalX = baseX + offset.dx;
        const finalY = baseY + offset.dy;
        
        const fo = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
        fo.setAttribute("x", (finalX - 60).toFixed(1));
        fo.setAttribute("y", (finalY - 14).toFixed(1));
        fo.setAttribute("width", "150");
        fo.setAttribute("height", "32");
        fo.setAttribute("style", "overflow: visible; pointer-events: none;");
        fo.setAttribute("data-gene", key);
        
        const box = document.createElement("div");
        
        // Selected highlight style
        let boxClass = "gsh-gene-overlay-container";
        if (selectedGenes.has(key)) {
            boxClass += " element-selected";
        }
        box.className = boxClass;
        box.style.display = "inline-flex";
        box.style.alignItems = "center";
        box.style.gap = "4px";
        box.style.whiteSpace = "nowrap";
        box.style.cursor = isGshEditMode ? "move" : "grab";
        box.style.userSelect = "none";
        box.style.pointerEvents = "auto";
        
        const geneText = document.createElement("span");
        geneText.className = "gsh-gene-text";
        geneText.innerText = symbol;
        
        if (symbol === "GEX1" || symbol === "OPT1") {
            geneText.classList.add("gsh-gene-text-black");
        }
        
        const indicator = document.createElement("div");
        indicator.className = "gsh-gene-indicator";
        
        const log2fc = parseFloat(item.rep_log2fc);
        const absFC = Math.abs(log2fc);
        
        if (log2fc > 0.5) {
            const alpha = Math.min(0.9, 0.35 + ((absFC - 0.5) / 2.0) * 0.55);
            indicator.style.backgroundColor = `rgba(239, 68, 68, ${alpha})`;
            indicator.style.borderColor = `rgba(239, 68, 68, ${Math.min(1.0, alpha + 0.15)})`;
            indicator.classList.add("gsh-gene-up-pulse");
        } else if (log2fc < -0.5) {
            const alpha = Math.min(0.9, 0.35 + ((absFC - 0.5) / 2.0) * 0.55);
            indicator.style.backgroundColor = `rgba(99, 102, 241, ${alpha})`;
            indicator.style.borderColor = `rgba(99, 102, 241, ${Math.min(1.0, alpha + 0.15)})`;
            indicator.classList.add("gsh-gene-down-pulse");
        } else {
            indicator.style.backgroundColor = `rgba(148, 163, 184, 0.2)`;
            indicator.style.borderColor = `rgba(148, 163, 184, 0.4)`;
        }
        
        box.appendChild(geneText);
        box.appendChild(indicator);
        
        // If edit-mode delete tool is active, display a small deletion badge next to custom genes
        if (isGshEditMode) {
            box.addEventListener("click", (e) => {
                e.stopPropagation();
                if (activeGshTool === 'delete') {
                    if (confirm(`유전자 배지 '${symbol}'을 삭제하시겠습니까?`)) {
                        deleteGeneElement(key);
                    }
                } else if (!activeGshTool) {
                    // Toggle Selection
                    if (e.ctrlKey || e.shiftKey) {
                        if (selectedGenes.has(key)) selectedGenes.delete(key);
                        else selectedGenes.add(key);
                    } else {
                        clearSelection();
                        selectedGenes.add(key);
                    }
                    renderGSHPathway();
                }
            });
        }
        
        fo.appendChild(box);
        
        // Drag and Drop (Bulk Dragging supported)
        let startMux = 0;
        let startMuy = 0;
        let isMoving = false;
        
        box.addEventListener("mousedown", (e) => {
            if (activeGshTool === 'add-arrow') return; // Let background canvas handle drag drawing!
            
            e.stopPropagation();
            if (e.button !== 0) return;
            if (activeGshTool === 'delete') return; // let click handle delete
            
            // Selection handling
            if (!activeGshTool) {
                if (e.ctrlKey || e.shiftKey) {
                    if (selectedGenes.has(key)) selectedGenes.delete(key);
                    else selectedGenes.add(key);
                } else {
                    if (!selectedGenes.has(key)) {
                        clearSelection();
                        selectedGenes.add(key);
                    }
                }
                renderGSHPathway();
            }
            
            isMoving = true;
            box.style.cursor = "grabbing";
            startMux = e.clientX;
            startMuy = e.clientY;
            
            // Capture offsets of selected genes
            const startOffsets = {};
            startOffsets[key] = JSON.parse(JSON.stringify(savedOffsets[key] || { dx: 0, dy: 0 })); // Ensure current dragged gene is captured
            selectedGenes.forEach(geneKey => {
                startOffsets[geneKey] = JSON.parse(JSON.stringify(savedOffsets[geneKey] || { dx: 0, dy: 0 }));
            });
            
            // Capture coords of selected nodes
            const nodesMap = getNodesMap();
            const startCoords = {};
            selectedNodes.forEach(nid => {
                const n = nodesMap[nid];
                if (n) startCoords[nid] = { x: n.x, y: n.y };
            });
            
            // Capture start coordinates of all selected arrows for delta movement
            const startArrowCoords = {};
            selectedArrows.forEach(aid => {
                const arrow = currentMap.arrows.find(a => a.id === aid);
                if (arrow) {
                    startArrowCoords[aid] = {
                        fromCoords: arrow.fromCoords ? { x: arrow.fromCoords.x, y: arrow.fromCoords.y } : null,
                        toCoords: arrow.toCoords ? { x: arrow.toCoords.x, y: arrow.toCoords.y } : null
                    };
                }
            });
            
            const handleMouseMove = (mvEvent) => {
                if (!isMoving) return;
                
                const deltaMux = mvEvent.clientX - startMux;
                const deltaMuy = mvEvent.clientY - startMuy;
                
                const correctedDx = deltaMux / gshZoomScale;
                const correctedDy = deltaMuy / gshZoomScale;
                
                if (selectedGenes.has(key)) {
                    // Bulk Move Genes
                    selectedGenes.forEach(geneKey => {
                        const sOffset = startOffsets[geneKey];
                        if (sOffset) {
                            savedOffsets[geneKey] = {
                                dx: sOffset.dx + correctedDx,
                                dy: sOffset.dy + correctedDy
                            };
                        }
                    });
                    setGshGeneOffsets(currentMapId, savedOffsets);
                    
                    // Bulk Move Nodes
                    selectedNodes.forEach(nid => {
                        const n = nodesMap[nid];
                        const sCoord = startCoords[nid];
                        if (n && sCoord) {
                            n.x = sCoord.x + correctedDx;
                            n.y = sCoord.y + correctedDy;
                        }
                    });
                    
                    // Also bulk move selected arrows
                    selectedArrows.forEach(aid => {
                        const arrow = currentMap.arrows.find(a => a.id === aid);
                        const sArrowCoord = startArrowCoords[aid];
                        if (arrow && sArrowCoord) {
                            if (arrow.fromCoords && sArrowCoord.fromCoords) {
                                arrow.fromCoords.x = sArrowCoord.fromCoords.x + correctedDx;
                                arrow.fromCoords.y = sArrowCoord.fromCoords.y + correctedDy;
                            }
                            if (arrow.toCoords && sArrowCoord.toCoords) {
                                arrow.toCoords.x = sArrowCoord.toCoords.x + correctedDx;
                                arrow.toCoords.y = sArrowCoord.toCoords.y + correctedDy;
                            }
                        }
                    });
                } else {
                    // Single Gene move
                    const sOffset = startOffsets[key];
                    const currentOffsets = getGshGeneOffsets(currentMapId);
                    if (sOffset) {
                        currentOffsets[key] = {
                            dx: sOffset.dx + correctedDx,
                            dy: sOffset.dy + correctedDy
                        };
                    }
                    setGshGeneOffsets(currentMapId, currentOffsets);
                }
                
                renderGSHPathway();
            };
            
            const handleMouseUp = () => {
                if (isMoving) {
                    isMoving = false;
                    box.style.cursor = isGshEditMode ? "move" : "grab";
                    
                    document.removeEventListener("mousemove", handleMouseMove);
                    document.removeEventListener("mouseup", handleMouseUp);
                    
                    saveAllPathwayMaps();
                    renderGSHPathway();
                }
            };
            
            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("mouseup", handleMouseUp);
        });
        
        // Double click to rename custom gene
        box.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            const custom = getGshCustomGenes(currentMapId);
            const cg = custom.find(g => g.id === key);
            if (cg) {
                const newSymbol = prompt("유전자 이름을 수정하세요:", cg.symbol);
                if (newSymbol !== null && newSymbol.trim() !== "" && newSymbol.trim() !== cg.symbol) {
                    const cleanSymbol = newSymbol.trim().toUpperCase();
                    cg.symbol = cleanSymbol;
                    
                    // Update log2fc & isoforms for renamed symbol
                    let repLog2fc = 0.0;
                    let geneIsoforms = [];
                    if (gGenes && gGenes.length > 0) {
                        const match = gGenes.find(g => (g.gene_symbol && g.gene_symbol.toUpperCase() === cleanSymbol) || (g.locus_tag && g.locus_tag.toUpperCase() === cleanSymbol));
                        if (match) {
                            repLog2fc = parseFloat(match.log2fc) || 0.0;
                            geneIsoforms = [match];
                        }
                    }
                    cg.rep_log2fc = repLog2fc;
                    cg.genes = geneIsoforms;
                    
                    setGshCustomGenes(currentMapId, custom);
                    loadGSHPathwayData();
                }
            }
        });
        
        // Tooltip bindings
        box.addEventListener("mouseenter", (e) => {
            if (isGshEditMode) return; // disable tooltip in edit mode for clarity
            
            let tooltipHtml = `<strong>${symbol}</strong> (Isoforms: ${item.genes ? item.genes.length : 0}개)<br/>`;
            tooltipHtml += `<div style="margin-top: 5px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 4px;">`;
            
            if (item.genes && item.genes.length > 0) {
                item.genes.forEach(g => {
                    const fcText = parseFloat(g.log2fc).toFixed(3);
                    const pValText = parseFloat(g.p_value).toExponential(3);
                    let fcColor = '#94a3b8';
                    if (g.log2fc > 0.5) fcColor = '#f87171';
                    else if (g.log2fc < -0.5) fcColor = '#818cf8';
                    
                    tooltipHtml += `<span style="font-weight:600; color:#e2e8f0;">${g.locus_tag}</span> (${g.gene_symbol || 'N/A'}): `;
                    tooltipHtml += `<span style="color:${fcColor}; font-weight:600;">${g.log2fc >= 0 ? '+' : ''}${fcText}</span> `;
                    tooltipHtml += `<span style="color:#a1a1aa; font-size:10px;">(p:${pValText})</span><br/>`;
                });
            } else {
                tooltipHtml += `<span style="color:#a1a1aa;">DEG 분석 데이터에 없는 수동 등록 유전자입니다.</span>`;
            }
            tooltipHtml += `</div>`;
            
            tooltip.innerHTML = tooltipHtml;
            tooltip.style.display = "block";
            
            const rect = indicator.getBoundingClientRect();
            tooltip.style.left = `${window.scrollX + rect.left + rect.width / 2 - tooltip.offsetWidth / 2}px`;
            tooltip.style.top = `${window.scrollY + rect.top - tooltip.offsetHeight - 8}px`;
        });
        
        box.addEventListener("mouseleave", () => {
            tooltip.style.display = "none";
        });
        
        overlayLayer.appendChild(fo);
    });
    
    // Filter out deleted default genes if any
    deletedDefaults.forEach(delKey => {
        const foEl = overlayLayer.querySelector(`foreignObject[data-gene="${delKey}"]`);
        if (foEl) foEl.remove();
    });
}

// ----------------------------------------------------------------------
// Custom Pathway Zoom & Pan Implementation
// ----------------------------------------------------------------------
let gshZoomScale = 1.0;
let gshZoomPanX = 0;
let gshZoomPanY = 0;
let gshIsDragging = false;
let gshStartX = 0;
let gshStartY = 0;
let gshSpacePressed = false;

// Global listeners to track Spacebar state
window.addEventListener("keydown", (e) => {
    if (e.code === "Space" || e.key === " ") {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.tagName === "SELECT")) {
            return;
        }
        gshSpacePressed = true;
        const wrapper = document.querySelector(".gsh-pathway-wrapper");
        if (wrapper && document.getElementById("custom-pathway-tab").classList.contains("active")) {
            e.preventDefault();
            wrapper.style.cursor = "grab";
        }
    }
});

window.addEventListener("keyup", (e) => {
    if (e.code === "Space" || e.key === " ") {
        gshSpacePressed = false;
        const wrapper = document.querySelector(".gsh-pathway-wrapper");
        if (wrapper && document.getElementById("custom-pathway-tab").classList.contains("active")) {
            wrapper.style.cursor = isGshEditMode ? "default" : "grab";
        }
    }
});

function initGSHZoomPan() {
    const wrapper = document.querySelector(".gsh-pathway-wrapper");
    const content = document.getElementById("gsh-pathway-content");
    if (!wrapper || !content) return;
    
    // Disable contextual menu on right click to allow smooth dragging without pops
    wrapper.addEventListener("contextmenu", (e) => {
        e.preventDefault();
    });
    
    // Zoom control buttons
    const btnIn = document.getElementById("btn-zoom-in");
    const btnOut = document.getElementById("btn-zoom-out");
    const btnReset = document.getElementById("btn-zoom-reset");
    const btnSync = document.getElementById("btn-refresh-gsh-pathway");
    
    if (btnIn) btnIn.addEventListener("click", () => adjustZoom(0.25));
    if (btnOut) btnOut.addEventListener("click", () => adjustZoom(-0.25));
    if (btnReset) btnReset.addEventListener("click", () => resetGSHZoom());
    if (btnSync) {
        btnSync.addEventListener("click", () => {
            if (confirm("현재 활성화된 대사 경로 레이아웃 및 커스텀 노드를 기본값으로 완전히 리셋하시겠습니까?")) {
                removeGshGeneData(currentMapId);
                
                // If resetting default map, clear map store entry to fetch raw default JSON
                if (currentMapId === "yeast_gsh_pathway") {
                    delete pathwayMapsStore["yeast_gsh_pathway"];
                    saveAllPathwayMaps();
                } else {
                    // For custom maps, just empty nodes and arrows
                    const currentMap = pathwayMapsStore[currentMapId];
                    if (currentMap) {
                        currentMap.nodes = [];
                        currentMap.arrows = [];
                        saveAllPathwayMaps();
                    }
                }
                
                // Clear active tool
                const toggleEdit = document.getElementById("toggle-edit-mode");
                if (toggleEdit) {
                    toggleEdit.checked = false;
                    isGshEditMode = false;
                    document.getElementById("gsh-editor-toolbar").style.display = "none";
                    setGshActiveTool(null);
                }
                
                clearSelection();
                loadGSHPathwayData();
                resetGSHZoom();
                alert("맵 레이아웃과 데이터가 초기값으로 완전히 리셋되었습니다.");
            }
        });
    }
    
    // Mouse Wheel Zoom
    wrapper.addEventListener("wheel", (e) => {
        if (document.getElementById("custom-pathway-tab").classList.contains("active")) {
            e.preventDefault();
            const zoomFactor = 0.08;
            const direction = e.deltaY < 0 ? 1 : -1;
            
            const rect = wrapper.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            const contentX = (mouseX - gshZoomPanX) / gshZoomScale;
            const contentY = (mouseY - gshZoomPanY) / gshZoomScale;
            
            const newScale = Math.max(0.6, Math.min(3.5, gshZoomScale + direction * zoomFactor));
            
            gshZoomPanX = mouseX - contentX * newScale;
            gshZoomPanY = mouseY - contentY * newScale;
            gshZoomScale = newScale;
            
            applyTransform();
        }
    }, { passive: false });
    
    // Mouse Drag Pan / Marquee Selection Handler
    let isMarqueeSelecting = false;
    let marqueeStartX = 0;
    let marqueeStartY = 0;
    const marqueeEl = document.getElementById("selection-marquee");
    
    wrapper.addEventListener("mousedown", (e) => {
        // Check if we should pan:
        // We pan if: 1) edit mode is OFF, OR 2) Space key is pressed, OR 3) Right click (2) or Middle click (1) is used
        const shouldPan = !isGshEditMode || gshSpacePressed || e.button === 1 || e.button === 2;
        
        if (shouldPan) {
            if (e.target.closest(".gsh-gene-overlay-container") || e.target.closest("button") || e.target.closest("a")) {
                return;
            }
            gshIsDragging = true;
            wrapper.style.cursor = "grabbing";
            gshStartX = e.clientX - gshZoomPanX;
            gshStartY = e.clientY - gshZoomPanY;
            e.preventDefault();
            return;
        }
        
        // Otherwise, perform Marquee Selection or Arrow Drawing in Edit Mode
        if (isGshEditMode) {
            if (activeGshTool === 'add-arrow') {
                if (e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                
                const currentMap = pathwayMapsStore[currentMapId];
                if (!currentMap) return;
                
                const mapWidth = currentMap.width || 1024;
                const mapHeight = currentMap.height || 580;
                
                const svgEl = document.getElementById("gsh-pathway-svg");
                if (!svgEl) return;
                
                // Convert mouse position to Zoom & Pan corrected SVG coordinates
                const getSvgCoords = (clientX, clientY) => {
                    const rect = svgEl.getBoundingClientRect();
                    const x = ((clientX - rect.left) / rect.width) * mapWidth;
                    const y = ((clientY - rect.top) / rect.height) * mapHeight;
                    return { x: Math.round(x), y: Math.round(y) };
                };
                
                const startPt = getSvgCoords(e.clientX, e.clientY);
                
                // Create dashed preview path
                const arrowsLayer = document.getElementById("gsh-pathway-arrows");
                const tempPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
                tempPath.setAttribute("stroke", "#3b82f6");
                tempPath.setAttribute("stroke-width", "2");
                tempPath.setAttribute("stroke-dasharray", "4,4");
                tempPath.setAttribute("fill", "none");
                tempPath.setAttribute("marker-end", "url(#arrowhead)");
                tempPath.setAttribute("d", `M ${startPt.x} ${startPt.y} L ${startPt.x} ${startPt.y}`);
                if (arrowsLayer) arrowsLayer.appendChild(tempPath);
                
                const handleArrowDrawingMove = (mvEvent) => {
                    let currentPt = getSvgCoords(mvEvent.clientX, mvEvent.clientY);
                    
                    if (mvEvent.ctrlKey) {
                        const dx = Math.abs(currentPt.x - startPt.x);
                        const dy = Math.abs(currentPt.y - startPt.y);
                        if (dx > dy) {
                            currentPt.y = startPt.y;
                        } else {
                            currentPt.x = startPt.x;
                        }
                    }
                    
                    tempPath.setAttribute("d", `M ${startPt.x} ${startPt.y} L ${currentPt.x} ${currentPt.y}`);
                };
                
                const handleArrowDrawingUp = (muEvent) => {
                    document.removeEventListener("mousemove", handleArrowDrawingMove);
                    document.removeEventListener("mouseup", handleArrowDrawingUp);
                    
                    tempPath.remove();
                    
                    let endPt = getSvgCoords(muEvent.clientX, muEvent.clientY);
                    
                    if (muEvent.ctrlKey) {
                        const dx = Math.abs(endPt.x - startPt.x);
                        const dy = Math.abs(endPt.y - startPt.y);
                        if (dx > dy) {
                            endPt.y = startPt.y;
                        } else {
                            endPt.x = startPt.x;
                        }
                    }
                    
                    const dist = Math.sqrt(Math.pow(endPt.x - startPt.x, 2) + Math.pow(endPt.y - startPt.y, 2));
                    
                    if (dist > 8) {
                        const selectedType = document.querySelector('input[name="arrow-type"]:checked')?.value || 'straight';
                        const selectedDir = document.querySelector('input[name="arrow-dir"]:checked')?.value || 'forward';
                        
                        const newArrowId = `arrow_${Date.now()}`;
                        const newArrow = {
                            id: newArrowId,
                            from: null,
                            to: null,
                            fromCoords: startPt,
                            toCoords: endPt,
                            type: selectedType,
                            direction: selectedDir
                        };
                        currentMap.arrows.push(newArrow);
                        saveAllPathwayMaps();
                        // setGshActiveTool(null); // Keep tool active for consecutive drawing
                        renderGSHPathway();
                    }
                };
                
                document.addEventListener("mousemove", handleArrowDrawingMove);
                document.addEventListener("mouseup", handleArrowDrawingUp);
                return;
            }
            
            // Drag marquee selection ONLY when clicking SVG background
            if (e.target.tagName !== "rect" && e.target.id !== "gsh-pathway-svg") {
                return;
            }
            if (e.button !== 0) return;
            
            if (activeGshTool) return; // ignore marquee selection when edit tools are active
            
            isMarqueeSelecting = true;
            const rect = wrapper.getBoundingClientRect();
            marqueeStartX = e.clientX - rect.left;
            marqueeStartY = e.clientY - rect.top;
            
            marqueeEl.style.left = `${marqueeStartX}px`;
            marqueeEl.style.top = `${marqueeStartY}px`;
            marqueeEl.style.width = "0px";
            marqueeEl.style.height = "0px";
            marqueeEl.style.display = "block";
            
            if (!e.ctrlKey && !e.shiftKey) {
                clearSelection();
                renderGSHPathway();
            }
            
            const handleMarqueeMove = (mvEvent) => {
                if (!isMarqueeSelecting) return;
                
                const currentX = mvEvent.clientX - rect.left;
                const currentY = mvEvent.clientY - rect.top;
                
                const x = Math.min(marqueeStartX, currentX);
                const y = Math.min(marqueeStartY, currentY);
                const w = Math.abs(marqueeStartX - currentX);
                const h = Math.abs(marqueeStartY - currentY);
                
                marqueeEl.style.left = `${x}px`;
                marqueeEl.style.top = `${y}px`;
                marqueeEl.style.width = `${w}px`;
                marqueeEl.style.height = `${h}px`;
            };
            
            const handleMarqueeUp = (muEvent) => {
                if (!isMarqueeSelecting) return;
                isMarqueeSelecting = false;
                marqueeEl.style.display = "none";
                
                document.removeEventListener("mousemove", handleMarqueeMove);
                document.removeEventListener("mouseup", handleMarqueeUp);
                
                const currentX = muEvent.clientX - rect.left;
                const currentY = muEvent.clientY - rect.top;
                
                const x1 = Math.min(marqueeStartX, currentX);
                const y1 = Math.min(marqueeStartY, currentY);
                const x2 = Math.max(marqueeStartX, currentX);
                const y2 = Math.max(marqueeStartY, currentY);
                
                // If it is just a tiny click, do not perform box selection
                if (x2 - x1 < 4 && y2 - y1 < 4) {
                    return;
                }
                
                const currentMap = pathwayMapsStore[currentMapId];
                if (!currentMap) return;
                
                const mapWidth = currentMap.width || 1024;
                const mapHeight = currentMap.height || 580;
                
                const svgEl = document.getElementById("gsh-pathway-svg");
                const svgRect = svgEl.getBoundingClientRect();
                
                // Helper: determines if relative SVG coordinate (cx, cy) falls within marquee selection rectangle
                const isPointInMarquee = (cx, cy) => {
                    const screenX = svgRect.left - rect.left + (cx / mapWidth) * svgRect.width;
                    const screenY = svgRect.top - rect.top + (cy / mapHeight) * svgRect.height;
                    return screenX >= x1 && screenX <= x2 && screenY >= y1 && screenY <= y2;
                };
                
                // 1. Gather nodes
                currentMap.nodes.forEach(node => {
                    const corners = [
                        { x: node.x, y: node.y },
                        { x: node.x + node.w, y: node.y },
                        { x: node.x, y: node.y + node.h },
                        { x: node.x + node.w, y: node.y + node.h }
                    ];
                    const isInside = corners.some(c => isPointInMarquee(c.x, c.y));
                    if (isInside) {
                        selectedNodes.add(node.id);
                    }
                });
                
                // 2. Gather genes
                const savedOffsets = getGshGeneOffsets(currentMapId);
                const customGenes = getGshCustomGenes(currentMapId);
                
                const mergedResults = JSON.parse(JSON.stringify(window.lastGSHResults || {}));
                customGenes.forEach(cg => {
                    if (!mergedResults[cg.symbol]) {
                        mergedResults[cg.symbol] = { x: cg.x, y: cg.y };
                    }
                });
                
                const deletedDefaults = getGshDeletedDefaultGenes(currentMapId);
                deletedDefaults.forEach(delKey => {
                    delete mergedResults[delKey];
                });
                
                Object.keys(mergedResults).forEach(key => {
                    const item = mergedResults[key];
                    const baseX = (item.x * mapWidth) / 100;
                    const baseY = (item.y * mapHeight) / 100;
                    const offset = savedOffsets[key] || { dx: 0, dy: 0 };
                    const finalX = baseX + offset.dx;
                    const finalY = baseY + offset.dy;
                    
                    if (isPointInMarquee(finalX, finalY)) {
                        selectedGenes.add(key);
                    }
                });
                
                // 3. Gather arrows (if both ends or either end falls inside selection rectangle)
                currentMap.arrows.forEach(arrow => {
                    const nodesMap = getNodesMap();
                    const fromNode = arrow.from ? nodesMap[arrow.from] : null;
                    const toNode = arrow.to ? nodesMap[arrow.to] : null;
                    
                    let p1 = fromNode ? { x: fromNode.x + fromNode.w / 2, y: fromNode.y + fromNode.h / 2 } : (arrow.fromCoords || { x: 100, y: 100 });
                    let p2 = toNode ? { x: toNode.x + toNode.w / 2, y: toNode.y + toNode.h / 2 } : (arrow.toCoords || { x: 200, y: 200 });
                    
                    if (isPointInMarquee(p1.x, p1.y) || isPointInMarquee(p2.x, p2.y)) {
                        selectedArrows.add(arrow.id);
                    }
                });
                
                renderGSHPathway();
            };
            
            document.addEventListener("mousemove", handleMarqueeMove);
            document.addEventListener("mouseup", handleMarqueeUp);
        }
    });
    
    window.addEventListener("mousemove", (e) => {
        if (!gshIsDragging) return;
        gshZoomPanX = e.clientX - gshStartX;
        gshZoomPanY = e.clientY - gshStartY;
        applyTransform();
    });
    
    window.addEventListener("mouseup", () => {
        if (gshIsDragging) {
            gshIsDragging = false;
            wrapper.style.cursor = isGshEditMode ? "default" : "grab";
        }
    });
}

function adjustZoom(amount) {
    const wrapper = document.querySelector(".gsh-pathway-wrapper");
    if (!wrapper) return;
    
    const rect = wrapper.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    const contentX = (centerX - gshZoomPanX) / gshZoomScale;
    const contentY = (centerY - gshZoomPanY) / gshZoomScale;
    
    const newScale = Math.max(0.6, Math.min(3.5, gshZoomScale + amount));
    
    gshZoomPanX = centerX - contentX * newScale;
    gshZoomPanY = centerY - contentY * newScale;
    gshZoomScale = newScale;
    
    applyTransform();
}

function resetGSHZoom() {
    gshZoomScale = 1.0;
    gshZoomPanX = 0;
    gshZoomPanY = 0;
    applyTransform();
    
    const wrapper = document.querySelector(".gsh-pathway-wrapper");
    if (wrapper) wrapper.style.cursor = isGshEditMode ? "default" : "grab";
}

function applyTransform() {
    const content = document.getElementById("gsh-pathway-content");
    if (content) {
        content.style.transform = `translate(${gshZoomPanX}px, ${gshZoomPanY}px) scale(${gshZoomScale})`;
    }
}

// Keyboard Hotkey Bindings (Delete, Copy Ctrl+C, Paste Ctrl+V)
function initGSHHotkeyBindings() {
    document.addEventListener("keydown", (e) => {
        if (!isGshEditMode) return;
        
        // Prevent hotkeys from triggering when user is editing input forms
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.tagName === "SELECT")) {
            return;
        }
        
        const currentMap = pathwayMapsStore[currentMapId];
        if (!currentMap) return;
        
        // Delete Selection
        if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            const totalSelected = selectedNodes.size + selectedArrows.size + selectedGenes.size;
            if (totalSelected === 0) return;
            
            if (confirm(`선택한 ${totalSelected}개의 요소를 삭제하시겠습니까?`)) {
                const nodesMap = getNodesMap();
                
                // 1. Delete Arrows
                currentMap.arrows = currentMap.arrows.filter(arrow => !selectedArrows.has(arrow.id));
                selectedArrows.clear();
                
                // 2. Delete Nodes (with boundary backup endpoints)
                selectedNodes.forEach(nid => {
                    const node = nodesMap[nid];
                    if (node) {
                        currentMap.arrows.forEach(arrow => {
                            if (arrow.from === node.id) {
                                const pathStr = calculateArrowPath(arrow, nodesMap);
                                const match = pathStr.match(/M\s+([\d.-]+)\s+([\d.-]+)/);
                                if (match) {
                                    arrow.fromCoords = { x: parseFloat(match[1]), y: parseFloat(match[2]) };
                                }
                                arrow.from = null;
                            }
                            if (arrow.to === node.id) {
                                const pathStr = calculateArrowPath(arrow, nodesMap);
                                arrow.toCoords = { x: node.x + node.w / 2, y: node.y + node.h / 2 };
                                arrow.to = null;
                            }
                        });
                        currentMap.nodes = currentMap.nodes.filter(n => n.id !== nid);
                    }
                });
                selectedNodes.clear();
                
                // 3. Delete Genes
                selectedGenes.forEach(key => {
                    let custom = getGshCustomGenes(currentMapId);
                    const originLen = custom.length;
                    custom = custom.filter(cg => cg.symbol !== key);
                    setGshCustomGenes(currentMapId, custom);
                    
                    const offsets = getGshGeneOffsets(currentMapId);
                    delete offsets[key];
                    setGshGeneOffsets(currentMapId, offsets);
                    
                    if (originLen === custom.length) {
                        const deletedDefaults = getGshDeletedDefaultGenes(currentMapId);
                        deletedDefaults.push(key);
                        setGshDeletedDefaultGenes(currentMapId, deletedDefaults);
                    }
                });
                selectedGenes.clear();
                
                saveAllPathwayMaps();
                loadGSHPathwayData();
            }
        }
        
        // Ctrl + C (Copy)
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
            e.preventDefault();
            
            const nodesMap = getNodesMap();
            const customGenes = getGshCustomGenes(currentMapId);
            const savedOffsets = getGshGeneOffsets(currentMapId);
            
            const copiedNodes = [];
            const copiedArrows = [];
            const copiedGenes = [];
            
            selectedNodes.forEach(nid => {
                const node = nodesMap[nid];
                if (node) copiedNodes.push(JSON.parse(JSON.stringify(node)));
            });
            
            selectedArrows.forEach(aid => {
                const arrow = currentMap.arrows.find(a => a.id === aid);
                if (arrow) copiedArrows.push(JSON.parse(JSON.stringify(arrow)));
            });
            
            selectedGenes.forEach(key => {
                const isCustom = customGenes.some(cg => cg.symbol === key);
                const offset = savedOffsets[key] || { dx: 0, dy: 0 };
                
                let geneObj = null;
                if (isCustom) {
                    const cg = customGenes.find(g => g.symbol === key);
                    geneObj = JSON.parse(JSON.stringify(cg));
                    geneObj.isCustom = true;
                } else {
                    const deg = window.lastGSHResults[key];
                    if (deg) {
                        geneObj = {
                            symbol: key,
                            x: deg.x,
                            y: deg.y,
                            rep_log2fc: deg.rep_log2fc,
                            genes: deg.genes,
                            isCustom: false
                        };
                    }
                }
                if (geneObj) {
                    geneObj.dx = offset.dx;
                    geneObj.dy = offset.dy;
                    copiedGenes.push(geneObj);
                }
            });
            
            if (copiedNodes.length > 0 || copiedArrows.length > 0 || copiedGenes.length > 0) {
                clipboardBuffer = {
                    nodes: copiedNodes,
                    arrows: copiedArrows,
                    genes: copiedGenes
                };
            }
        }
        
        // Ctrl + V (Paste)
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
            e.preventDefault();
            if (!clipboardBuffer) return;
            
            const idMap = {};
            const timestamp = Date.now();
            clearSelection();
            
            // Paste Nodes
            clipboardBuffer.nodes.forEach((oldNode, idx) => {
                const newNode = JSON.parse(JSON.stringify(oldNode));
                newNode.id = `node_${timestamp}_${idx}_${Math.round(Math.random() * 100)}`;
                newNode.x += 40; // paste spacing offset
                newNode.y += 40;
                idMap[oldNode.id] = newNode.id;
                
                currentMap.nodes.push(newNode);
                selectedNodes.add(newNode.id);
            });
            
            // Paste Genes
            const customGenes = getGshCustomGenes(currentMapId);
            const savedOffsets = getGshGeneOffsets(currentMapId);
            
            clipboardBuffer.genes.forEach((g) => {
                let symbol = g.symbol;
                let suffix = 1;
                while (
                    customGenes.some(cg => cg.symbol === symbol) || 
                    (window.lastGSHResults[symbol] && !clipboardBuffer.genes.some(bg => bg.symbol === symbol && bg.isCustom === false))
                ) {
                    symbol = `${g.symbol}_copy${suffix}`;
                    suffix++;
                }
                
                customGenes.push({
                    symbol: symbol,
                    x: g.x,
                    y: g.y,
                    rep_log2fc: g.rep_log2fc,
                    genes: g.genes
                });
                
                savedOffsets[symbol] = {
                    dx: g.dx + 40,
                    dy: g.dy + 40
                };
                
                selectedGenes.add(symbol);
            });
            
            setGshCustomGenes(currentMapId, customGenes);
            setGshGeneOffsets(currentMapId, savedOffsets);
            
            // Paste Arrows
            clipboardBuffer.arrows.forEach((oldArrow, idx) => {
                const newArrow = JSON.parse(JSON.stringify(oldArrow));
                newArrow.id = `arr_${timestamp}_${idx}_${Math.round(Math.random() * 100)}`;
                
                if (oldArrow.from && idMap[oldArrow.from]) {
                    newArrow.from = idMap[oldArrow.from];
                } else if (oldArrow.from) {
                    newArrow.from = oldArrow.from;
                }
                
                if (oldArrow.to && idMap[oldArrow.to]) {
                    newArrow.to = idMap[oldArrow.to];
                } else if (oldArrow.to) {
                    newArrow.to = oldArrow.to;
                }
                
                if (newArrow.fromCoords) {
                    newArrow.fromCoords.x += 40;
                    newArrow.fromCoords.y += 40;
                }
                if (newArrow.toCoords) {
                    newArrow.toCoords.x += 40;
                    newArrow.toCoords.y += 40;
                }
                
                currentMap.arrows.push(newArrow);
                selectedArrows.add(newArrow.id);
            });
            
            saveAllPathwayMaps();
            loadGSHPathwayData();
        }
    });
}

// ----------------------------------------------------------------------
// Custom Pathway Editor Event Bindings
// ----------------------------------------------------------------------
function initGSHEditorBindings() {
    const toggleEdit = document.getElementById("toggle-edit-mode");
    const toolbar = document.getElementById("gsh-editor-toolbar");
    const svgEl = document.getElementById("gsh-pathway-svg");
    const mapSelect = document.getElementById("pathway-map-select");
    
    if (!toggleEdit || !toolbar || !svgEl) return;
    
    // Bind global keyboard shortcuts
    initGSHHotkeyBindings();
    
    // Map dropdown change listener
    if (mapSelect) {
        mapSelect.addEventListener("change", (e) => {
            selectAndLoadMap(e.target.value);
        });
    }
    
    // Create new map
    const btnCreateMap = document.getElementById("btn-create-map");
    if (btnCreateMap) {
        btnCreateMap.addEventListener("click", () => {
            const name = prompt("새로운 대사 경로 맵 이름을 입력하세요:");
            if (name && name.trim() !== "") {
                const newMapId = `map_${Date.now()}`;
                pathwayMapsStore[newMapId] = {
                    name: name.trim(),
                    width: 1024,
                    height: 580,
                    nodes: [],
                    arrows: []
                };
                saveAllPathwayMaps();
                currentMapId = newMapId;
                loadGSHPathwayData();
                alert(`'${name.trim()}' 맵이 성공적으로 생성되었습니다.`);
            }
        });
    }
    
    // Rename current map
    const btnRenameMap = document.getElementById("btn-rename-map");
    if (btnRenameMap) {
        btnRenameMap.addEventListener("click", () => {
            const currentMap = pathwayMapsStore[currentMapId];
            if (!currentMap) return;
            const newName = prompt("맵의 새로운 이름을 입력하세요:", currentMap.name);
            if (newName && newName.trim() !== "" && newName.trim() !== currentMap.name) {
                currentMap.name = newName.trim();
                saveAllPathwayMaps();
                loadGSHPathwayData();
                alert("맵 이름이 변경되었습니다.");
            }
        });
    }
    
    // Delete current map
    const btnDeleteMap = document.getElementById("btn-delete-map");
    if (btnDeleteMap) {
        btnDeleteMap.addEventListener("click", () => {
            if (currentMapId === "yeast_gsh_pathway") {
                alert("기본 글루타치온 생합성 맵은 삭제할 수 없습니다.");
                return;
            }
            const currentMap = pathwayMapsStore[currentMapId];
            if (!currentMap) return;
            if (confirm(`'${currentMap.name}' 맵을 정말 완전히 삭제하시겠습니까?`)) {
                // Delete references
                removeGshGeneData(currentMapId);
                
                delete pathwayMapsStore[currentMapId];
                saveAllPathwayMaps();
                currentMapId = "yeast_gsh_pathway";
                loadGSHPathwayData();
                alert("맵이 완전히 삭제되었습니다.");
            }
        });
    }
    
    // Save current pathway map explicitly
    const btnSavePathway = document.getElementById("btn-save-gsh-pathway");
    if (btnSavePathway) {
        btnSavePathway.addEventListener("click", () => {
            saveAllPathwayMaps();
            alert("현재 대사 경로의 노드, 화살표, 유전자 배지 정렬 배치가 성공적으로 저장되었습니다.");
        });
    }
    
    // Apply Canvas Dimensions
    const btnApplySize = document.getElementById("btn-apply-size");
    if (btnApplySize) {
        btnApplySize.addEventListener("click", () => {
            const widthVal = parseInt(document.getElementById("canvas-width-input").value, 10);
            const heightVal = parseInt(document.getElementById("canvas-height-input").value, 10);
            
            if (isNaN(widthVal) || isNaN(heightVal) || widthVal < 200 || heightVal < 200) {
                alert("가로세로 크기는 최소 200px 이상 입력해야 합니다.");
                return;
            }
            
            const currentMap = pathwayMapsStore[currentMapId];
            if (currentMap) {
                const oldWidth = currentMap.width || 1024;
                const oldHeight = currentMap.height || 580;
                
                // Get all genes (defaults + custom) to perform offset adjustment
                const savedOffsets = JSON.parse(localStorage.getItem(`gsh_gene_offsets_${currentMapId}`) || "{}");
                const customGenes = JSON.parse(localStorage.getItem(`gsh_custom_genes_${currentMapId}`) || "[]");
                
                // Merge all genes
                const mergedResults = JSON.parse(JSON.stringify(window.lastGSHResults || {}));
                customGenes.forEach(cg => {
                    if (!mergedResults[cg.symbol]) {
                        mergedResults[cg.symbol] = { x: cg.x, y: cg.y };
                    }
                });
                
                // Adjust dx and dy offsets for all genes so their absolute coordinate is preserved
                Object.keys(mergedResults).forEach(key => {
                    const item = mergedResults[key];
                    const oldOffset = savedOffsets[key] || { dx: 0, dy: 0 };
                    
                    const newDx = oldOffset.dx + (item.x * (oldWidth - widthVal)) / 100;
                    const newDy = oldOffset.dy + (item.y * (oldHeight - heightVal)) / 100;
                    
                    savedOffsets[key] = {
                        dx: Math.round(newDx * 10) / 10,
                        dy: Math.round(newDy * 10) / 10
                    };
                });
                localStorage.setItem(`gsh_gene_offsets_${currentMapId}`, JSON.stringify(savedOffsets));
                
                currentMap.width = widthVal;
                currentMap.height = heightVal;
                saveAllPathwayMaps();
                selectAndLoadMap(currentMapId);
                alert(`맵의 해상도가 ${widthVal}x${heightVal}로 조절되었으며, 유전자 정렬 배치가 픽셀 단위로 자동 고정 보정되었습니다.`);
            }
        });
    }
    
    toggleEdit.addEventListener("change", (e) => {
        isGshEditMode = e.target.checked;
        clearSelection();
        if (isGshEditMode) {
            toolbar.style.display = "flex";
        } else {
            toolbar.style.display = "none";
            setGshActiveTool(null);
        }
        renderGSHPathway();
        resetGSHZoom(); // Align view when starting edit
    });
    
    const toolButtons = {
        'tool-add-node': 'add-node',
        'tool-add-arrow': 'add-arrow',
        'tool-add-gene': 'add-gene',
        'tool-delete': 'delete'
    };
    
    Object.keys(toolButtons).forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.addEventListener("click", () => {
                const tool = toolButtons[btnId];
                if (activeGshTool === tool) {
                    setGshActiveTool(null);
                } else {
                    setGshActiveTool(tool);
                }
            });
        }
    });
    
    svgEl.addEventListener("click", (e) => {
        if (!isGshEditMode || !activeGshTool) return;
        
        // Prevent action if clicking on existing nodes, arrows, or gene badges
        if (e.target.closest(".gsh-pathway-node-group") || e.target.closest(".gsh-pathway-arrow-group") || e.target.closest(".gsh-gene-badge-group")) {
            return;
        }
        
        const currentMap = pathwayMapsStore[currentMapId];
        if (!currentMap) return;
        
        const mapWidth = currentMap.width || 1024;
        const mapHeight = currentMap.height || 580;
        
        const rect = svgEl.getBoundingClientRect();
        const clickX = ((e.clientX - rect.left) / rect.width) * mapWidth;
        const clickY = ((e.clientY - rect.top) / rect.height) * mapHeight;
        
        if (activeGshTool === 'add-node') {
            const name = prompt("새로운 대사산물 이름을 입력하세요:");
            if (name && name.trim() !== "") {
                const newId = `node_${Date.now()}`;
                const newNode = {
                    id: newId,
                    label: name.trim(),
                    x: Math.round(clickX - 40),
                    y: Math.round(clickY - 12),
                    w: 80,
                    h: 24,
                    rx: 12,
                    type: "standard"
                };
                currentMap.nodes.push(newNode);
                saveAllPathwayMaps();
                setGshActiveTool(null);
                renderGSHPathway();
            }
        } else if (activeGshTool === 'add-gene') {
            const name = prompt("새로운 유전자 심볼(예: MET2)을 입력하세요:");
            if (name && name.trim() !== "") {
                const symbol = name.trim().toUpperCase();
                
                let repLog2fc = 0.0;
                let geneIsoforms = [];
                if (gGenes && gGenes.length > 0) {
                    const match = gGenes.find(g => (g.gene_symbol && g.gene_symbol.toUpperCase() === symbol) || (g.locus_tag && g.locus_tag.toUpperCase() === symbol));
                    if (match) {
                        repLog2fc = parseFloat(match.log2fc) || 0.0;
                        geneIsoforms = [match];
                    }
                }
                
                const percentX = (clickX / mapWidth) * 100;
                const percentY = (clickY / mapHeight) * 100;
                
                const custom = getGshCustomGenes(currentMapId);
                const newGeneId = `gene_${Date.now()}_${Math.round(Math.random() * 1000)}`;
                custom.push({
                    id: newGeneId,
                    symbol: symbol,
                    x: percentX,
                    y: percentY,
                    rep_log2fc: repLog2fc,
                    genes: geneIsoforms
                });
                setGshCustomGenes(currentMapId, custom);
                saveAllPathwayMaps();
                
                setGshActiveTool(null);
                loadGSHPathwayData();
            }
        }
    });
    
    // Node Align Tool Handlers
    const alignTypes = ['left', 'center', 'right', 'top', 'middle', 'bottom'];
    alignTypes.forEach(type => {
        const btn = document.getElementById(`btn-align-${type}`);
        if (btn) {
            btn.addEventListener("click", () => {
                alignSelectedNodes(type);
            });
        }
    });
    
    // Node Color Picker Click Handlers
    const colorBtns = document.querySelectorAll(".node-color-btn");
    colorBtns.forEach(btn => {
        btn.addEventListener("click", (e) => {
            const colorKey = e.target.getAttribute("data-color");
            if (colorKey) {
                changeSelectedNodesColor(colorKey);
            }
        });
    });

    // Export layout JSON
    const btnExport = document.getElementById("btn-export-layout");
    if (btnExport) {
        btnExport.addEventListener("click", () => {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(pathwayMapsStore[currentMapId], null, 2));
            const downloadAnchor = document.createElement('a');
            downloadAnchor.setAttribute("href", dataStr);
            downloadAnchor.setAttribute("download", `${pathwayMapsStore[currentMapId].name.replace(/\s+/g, '_')}_custom_layout.json`);
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
        });
    }
    
    // Import layout JSON trigger
    const btnImportTrigger = document.getElementById("btn-import-layout-trigger");
    const fileImportInput = document.getElementById("file-import-layout");
    if (btnImportTrigger && fileImportInput) {
        btnImportTrigger.addEventListener("click", () => {
            fileImportInput.click();
        });
        
        fileImportInput.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const parsed = JSON.parse(event.target.result);
                    if (parsed.nodes && parsed.arrows) {
                        const currentMap = pathwayMapsStore[currentMapId];
                        if (currentMap) {
                            currentMap.width = parsed.width || currentMap.width || 1024;
                            currentMap.height = parsed.height || currentMap.height || 580;
                            currentMap.nodes = parsed.nodes;
                            currentMap.arrows = parsed.arrows;
                            saveAllPathwayMaps();
                            selectAndLoadMap(currentMapId);
                            alert("대사 경로 레이아웃이 성공적으로 업로드 및 갱신되었습니다!");
                        }
                    } else {
                        alert("올바른 대사 경로 레이아웃 형식이 아닙니다 (nodes와 arrows 속성이 필요합니다).");
                    }
                } catch (err) {
                    alert("JSON 파일 파싱 실패: " + err.message);
                }
            };
            reader.readAsText(file);
        });
    }
}

function setGshActiveTool(tool) {
    activeGshTool = tool;
    selectedArrowSourceId = null; // reset arrow state
    
    const btns = document.querySelectorAll(".edit-tool-btn");
    btns.forEach(btn => btn.classList.remove("active"));
    
    const toolBtnMap = {
        'add-node': 'tool-add-node',
        'add-arrow': 'tool-add-arrow',
        'add-gene': 'tool-add-gene',
        'delete': 'tool-delete'
    };
    
    if (tool && toolBtnMap[tool]) {
        const activeBtn = document.getElementById(toolBtnMap[tool]);
        if (activeBtn) activeBtn.classList.add("active");
    }
}

function alignSelectedNodes(alignmentType) {
    if (selectedNodes.size < 2) {
        alert("정렬 기능을 사용하려면 최소 2개 이상의 노드를 선택해 주세요.");
        return;
    }
    
    const nodesMap = getNodesMap();
    const selNodes = Array.from(selectedNodes).map(id => nodesMap[id]).filter(n => n !== undefined);
    if (selNodes.length < 2) return;
    
    if (alignmentType === 'left') {
        const minX = Math.min(...selNodes.map(n => n.x));
        selNodes.forEach(n => { n.x = minX; });
    } else if (alignmentType === 'center') {
        const avgCenterX = selNodes.reduce((sum, n) => sum + (n.x + n.w / 2), 0) / selNodes.length;
        selNodes.forEach(n => { n.x = Math.round(avgCenterX - n.w / 2); });
    } else if (alignmentType === 'right') {
        const maxRight = Math.max(...selNodes.map(n => n.x + n.w));
        selNodes.forEach(n => { n.x = maxRight - n.w; });
    } else if (alignmentType === 'top') {
        const minY = Math.min(...selNodes.map(n => n.y));
        selNodes.forEach(n => { n.y = minY; });
    } else if (alignmentType === 'middle') {
        const avgCenterY = selNodes.reduce((sum, n) => sum + (n.y + n.h / 2), 0) / selNodes.length;
        selNodes.forEach(n => { n.y = Math.round(avgCenterY - n.h / 2); });
    } else if (alignmentType === 'bottom') {
        const maxBottom = Math.max(...selNodes.map(n => n.y + n.h));
        selNodes.forEach(n => { n.y = maxBottom - n.h; });
    }
    
    saveAllPathwayMaps();
    renderGSHPathway();
}

function changeSelectedNodesColor(colorKey) {
    if (selectedNodes.size === 0) {
        alert("색상을 변경할 노드를 먼저 선택해 주세요.");
        return;
    }
    
    const colorMap = {
        blue: { fill: "#eff6ff", stroke: "#3b82f6", text: "#1e3a8a" },
        green: { fill: "#ecfdf5", stroke: "#10b981", text: "#065f46" },
        red: { fill: "#fef2f2", stroke: "#ef4444", text: "#7f1d1d" },
        yellow: { fill: "#fffbeb", stroke: "#f59e0b", text: "#78350f" },
        purple: { fill: "#faf5ff", stroke: "#8b5cf6", text: "#581c87" },
        gray: { fill: "#f8fafc", stroke: "#64748b", text: "#334155" }
    };
    
    const colors = colorMap[colorKey];
    if (!colors) return;
    
    const nodesMap = getNodesMap();
    selectedNodes.forEach(nid => {
        const node = nodesMap[nid];
        if (node) {
            node.fillColor = colors.fill;
            node.strokeColor = colors.stroke;
            node.textColor = colors.text;
        }
    });
    
    saveAllPathwayMaps();
    renderGSHPathway();
}

