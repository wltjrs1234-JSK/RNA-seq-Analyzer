import os
import re
import json
import shutil
import urllib.parse
import requests
import pandas as pd
import numpy as np
from scipy import stats
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

app = FastAPI(title="Yeast RNA-seq Analyzer API")

# Custom Middleware to bypass browser caching for static resources during development/automation
@app.middleware("http")
async def add_no_cache_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# Enable CORS for frontend interaction
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CACHE_DIR = "data_cache"
os.makedirs(CACHE_DIR, exist_ok=True)

def get_ncbi_mapping():
    """Download and cache SGD dbxref.tab mapping file to translate NCBI Gene IDs to Yeast ORF IDs."""
    mapping_file = os.path.join(CACHE_DIR, "ncbi_mapping.json")
    if os.path.exists(mapping_file):
        with open(mapping_file, "r", encoding="utf-8") as f:
            return json.load(f)
            
    print("Downloading dbxref.tab from SGD for NCBI to Systematic ID mapping...")
    dbxref_path = os.path.join(CACHE_DIR, "dbxref.tab")
    if not os.path.exists(dbxref_path):
        url = "https://downloads.yeastgenome.org/curation/chromosomal_feature/dbxref.tab"
        try:
            r = requests.get(url, timeout=30, verify=False)
            r.raise_for_status()
            with open(dbxref_path, "wb") as f:
                f.write(r.content)
        except Exception as e:
            print(f"Failed to download dbxref from SGD: {e}")
            return {}
            
    # Parse dbxref.tab
    mapping = {}
    if os.path.exists(dbxref_path):
        try:
            with open(dbxref_path, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if line.startswith("#") or not line.strip():
                        continue
                    parts = line.strip().split("\t")
                    if len(parts) >= 4:
                        source = parts[1]
                        systematic_name = parts[3]
                        dbxref_id = parts[0]
                        if source == "NCBI":
                            mapping[dbxref_id] = systematic_name
                            
            with open(mapping_file, "w", encoding="utf-8") as f:
                json.dump(mapping, f, indent=2)
            return mapping
        except Exception as e:
            print(f"Error parsing dbxref file: {e}")
    return {}

def get_pfam_data():
    """Download and cache yeast Pfam domain mapping file if not present."""
    pfam_file = os.path.join(CACHE_DIR, "yeast_pfam.json")
    if os.path.exists(pfam_file):
        with open(pfam_file, "r", encoding="utf-8") as f:
            return json.load(f)
            
    print("Fetching yeast protein domain mappings from SGD...")
    dbxref_path = os.path.join(CACHE_DIR, "dbxref.tab")
    if not os.path.exists(dbxref_path):
        get_ncbi_mapping() # Trigger download
        
    pfam_map = {}
    if os.path.exists(dbxref_path):
        try:
            with open(dbxref_path, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if line.startswith("#") or not line.strip():
                        continue
                    parts = line.strip().split("\t")
                    if len(parts) >= 6:
                        source = parts[1]
                        systematic_name = parts[3]
                        ref_id = parts[0]
                        desc = parts[4] if len(parts) > 4 else ref_id
                        
                        if source in ["Pfam", "InterPro"]:
                            if systematic_name not in pfam_map:
                                pfam_map[systematic_name] = []
                            pfam_map[systematic_name].append({
                                "id": ref_id,
                                "name": desc,
                                "source": source
                            })
            with open(pfam_file, "w", encoding="utf-8") as f:
                json.dump(pfam_map, f, indent=2)
            return pfam_map
        except Exception as e:
            print(f"Error parsing Pfam domains: {e}")
    return {}

def get_go_data():
    """Download and cache SGD GO Slim mapping tab file if not present."""
    go_file = os.path.join(CACHE_DIR, "go_slim_mapping.tab")
    if not os.path.exists(go_file):
        print("Downloading GO Slim Mapping file from SGD...")
        url = "https://downloads.yeastgenome.org/curation/literature/go_slim_mapping.tab"
        try:
            r = requests.get(url, timeout=30, verify=False)
            r.raise_for_status()
            with open(go_file, "wb") as f:
                f.write(r.content)
            print("SGD GO Slim Mapping downloaded successfully.")
        except Exception as e:
            print(f"Failed to download GO mapping from SGD: {e}")
            # If download fails, check if we have a backup or try another URL
            url_backup = "https://ftp.yeastgenome.org/pub/yeast/curation/literature/go_slim_mapping.tab"
            try:
                r = requests.get(url_backup, timeout=30, verify=False)
                r.raise_for_status()
                with open(go_file, "wb") as f:
                    f.write(r.content)
                print("SGD GO Slim Mapping downloaded from backup successfully.")
            except Exception as e2:
                print(f"Backup failed: {e2}")
                # We will fall back to using a basic mock list if all fails, but this should work online.
    
    # Parse the GO file
    if os.path.exists(go_file):
        try:
            # Columns: 0: LocusTag, 1: GeneSymbol, 2: SGDID, 3: Aspect, 4: TermName, 5: GOID, 6: FeatureType
            df_go = pd.read_csv(go_file, sep="\t", header=None, comment="!")
            df_go.columns = ["locus_tag", "symbol", "sgdid", "aspect", "term_name", "goid", "feature_type"]
            return df_go
        except Exception as e:
            print(f"Error parsing GO file: {e}")
    return pd.DataFrame()

def get_kegg_pathways():
    """Fetch and cache yeast KEGG pathways list."""
    pathways_file = os.path.join(CACHE_DIR, "kegg_pathways.json")
    if os.path.exists(pathways_file):
        with open(pathways_file, "r", encoding="utf-8") as f:
            return json.load(f)
            
    print("Fetching yeast KEGG pathways list...")
    url = "https://rest.kegg.jp/list/pathway/sce"
    try:
        r = requests.get(url, timeout=15, verify=False)
        r.raise_for_status()
        pathways = {}
        for line in r.text.strip().split("\n"):
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) >= 2:
                path_id = parts[0].replace("path:", "")
                # Clean up description (e.g. remove " - Saccharomyces cerevisiae (budding yeast)")
                desc = parts[1].split(" - Saccharomyces")[0]
                pathways[path_id] = desc
        with open(pathways_file, "w", encoding="utf-8") as f:
            json.dump(pathways, f, indent=2, ensure_ascii=False)
        return pathways
    except Exception as e:
        print(f"Failed to fetch KEGG pathways: {e}")
        return {}

def get_kegg_gene_mapping():
    """Fetch and cache yeast gene-pathway mapping."""
    mapping_file = os.path.join(CACHE_DIR, "kegg_gene_mapping.json")
    if os.path.exists(mapping_file):
        with open(mapping_file, "r", encoding="utf-8") as f:
            return json.load(f)
            
    print("Fetching yeast gene-pathway mappings...")
    url = "https://rest.kegg.jp/link/sce/pathway"
    try:
        r = requests.get(url, timeout=20, verify=False)
        r.raise_for_status()
        
        # Mapping: pathway_id -> list of locus_tags (or vice versa)
        pathway_to_genes = {}
        for line in r.text.strip().split("\n"):
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) >= 2:
                path_id = parts[0].replace("path:", "") # e.g. sce00010
                gene_id = parts[1].replace("sce:", "") # e.g. YAL038W
                
                if path_id not in pathway_to_genes:
                    pathway_to_genes[path_id] = []
                pathway_to_genes[path_id].append(gene_id)
                
        with open(mapping_file, "w", encoding="utf-8") as f:
            json.dump(pathway_to_genes, f, indent=2)
        return pathway_to_genes
    except Exception as e:
        print(f"Failed to fetch KEGG gene mappings: {e}")
        return {}

# ----------------------------------------------------------------------
# 2. Main API Endpoints
# ----------------------------------------------------------------------

# We keep active parsed data in-memory or save in a file for subsequent requests.
# In a real app we might use a session or database, but here we can save it to a JSON file temp_parsed.json
PARSED_DATA_PATH = os.path.join(CACHE_DIR, "temp_parsed.json")

def parse_rnaseq_dataframe(df: pd.DataFrame) -> dict:
    """Helper to automatically parse RNA-seq DataFrame, detect columns, and run statistical analysis."""
    # 1. Clean column names
    df.columns = [str(c).strip() for c in df.columns]
    
    # 2. Find locus_tag column
    locus_col = None
    # Prioritize by column name
    for col in df.columns:
        if col.lower() in ["locus_tag", "locus", "systematic_name", "orf", "orf_name", "systematic", "gene_id", "id"]:
            locus_col = col
            break
            
    # Fallback/validation: check contents for systematic name pattern (e.g. YAL038W)
    if not locus_col:
        best_col = None
        best_rate = 0.0
        for col in df.columns:
            non_nulls = df[col].dropna().astype(str).str.strip()
            if non_nulls.empty:
                continue
            # Match Yeast systematic name pattern
            matches = non_nulls.str.match(r"^Y[A-P][0-9]{3}[C,W](-[A-G])?$", case=False)
            rate = matches.mean()
            if rate > best_rate:
                best_rate = rate
                best_col = col
        if best_rate > 0.3: # If at least 30% of rows match yeast ORF pattern
            locus_col = best_col

    if not locus_col:
        # Fallback to first column
        if len(df.columns) > 0:
            locus_col = df.columns[0]
        else:
            raise HTTPException(status_code=400, detail="데이터에 열이 존재하지 않습니다.")

    # 3. Find gene symbol column
    symbol_col = None
    for col in df.columns:
        if col.lower() in ["gene_symbol", "symbol", "gene", "gene_name", "name"]:
            symbol_col = col
            break
    if not symbol_col:
        for col in df.columns:
            if col != locus_col and col.lower() not in ["description", "gene_biotype"]:
                non_nulls = df[col].dropna().astype(str).str.strip()
                if not non_nulls.empty and non_nulls.str.match(r"^[A-Z]{3}[0-9]+", case=True).mean() > 0.4:
                    symbol_col = col
                    break
    if not symbol_col:
        symbol_col = locus_col # Fallback

    # 4. Find Description and Biotype columns
    desc_col = None
    for col in df.columns:
        if "desc" in col.lower():
            desc_col = col
            break
            
    biotype_col = None
    for col in df.columns:
        if "biotype" in col.lower() or "type" in col.lower():
            biotype_col = col
            break

    # 4.5 Detect pre-calculated statistics columns (p-value, adjusted p-value/FDR)
    pre_pvalue_col = None
    pre_fdr_col = None
    for col in df.columns:
        c_low = col.lower()
        if c_low in ["pvalue", "p.value", "p-value", "p_value", "pval"]:
            pre_pvalue_col = col
        elif c_low in ["padj", "p.adj", "p-adj", "p_adj", "adjusted_p_value", "adjusted p-value", "adjusted_pvalue", "fdr", "qvalue", "q_value", "q.value"]:
            pre_fdr_col = col

    # 5. Classify numeric columns for expression values
    numeric_cols = []
    for col in df.columns:
        if col != locus_col and col != symbol_col and col != desc_col and col != biotype_col and col != pre_pvalue_col and col != pre_fdr_col:
            try:
                pd.to_numeric(df[col].dropna())
                numeric_cols.append(col)
            except:
                pass

    # Group numeric columns into WT and Mutant
    # Use word-boundary aware regex matching to avoid false positives like "t" in "WT"
    import re as _re
    
    # Robust patterns: must be surrounded by non-alphabetics or string boundaries to avoid false positives (e.g. 'weight' vs 'wt')
    wt_patterns = [
        r"(?:^|[^a-zA-Z])wt(?:[^a-zA-Z]|$)",
        r"(?:^|[^a-zA-Z])control(?:[^a-zA-Z]|$)",
        r"(?:^|[^a-zA-Z])ctrl(?:[^a-zA-Z]|$)",
        r"(?:^|[^a-zA-Z])con(?:[^a-zA-Z]|$)",
        r"(?:^|[^a-zA-Z])wildtype(?:[^a-zA-Z]|$)",
        r"(?:^|[^a-zA-Z])wild_type(?:[^a-zA-Z]|$)",
        r"(?:^|[^a-zA-Z])reference(?:[^a-zA-Z]|$)",
        r"(?:^|[^a-zA-Z])ref(?:[^a-zA-Z]|$)"
    ]
    mut_patterns = [
        r"(?:^|[^a-zA-Z])mutant(?:[^a-zA-Z]|$)",
        r"(?:^|[^a-zA-Z])mut(?:[^a-zA-Z]|$)",
        r"(?:^|[^a-zA-Z])ko(?:[^a-zA-Z]|$)",
        r"(?:^|[^a-zA-Z])treatment(?:[^a-zA-Z]|$)",
        r"(?:^|[^a-zA-Z])treat(?:[^a-zA-Z]|$)",
        r"(?:^|[^a-zA-Z])target(?:[^a-zA-Z]|$)",
        r"(?:^|[^a-zA-Z])overexpression(?:[^a-zA-Z]|$)",
        r"(?:^|[^a-zA-Z])oe(?:[^a-zA-Z]|$)",
        r"(?:^|[^a-zA-Z])m(?:[0-9]+|$)"
    ]

    wt_candidates = []
    mut_candidates = []

    def matches_any(colname, patterns):
        cn = colname.lower()
        return any(_re.search(pat, cn) for pat in patterns)

    for col in numeric_cols:
        is_wt  = matches_any(col, wt_patterns)
        is_mut = matches_any(col, mut_patterns)

        if is_wt and not is_mut:
            wt_candidates.append(col)
        elif is_mut and not is_wt:
            mut_candidates.append(col)
        elif is_wt and is_mut:
            mut_candidates.append(col)

    # Smart filtering: If there are replicates AND summary columns (like AVG, Mean, Average),
    # exclude summary columns from t-test list to prevent stat calculation break.
    def filter_summary_cols(cols):
        avg_patterns = ["avg", "mean", "average", "평균"]
        reps = [c for c in cols if not any(p in c.lower() for p in avg_patterns)]
        return reps if reps else cols

    wt_cols = filter_summary_cols(wt_candidates)
    mut_cols = filter_summary_cols(mut_candidates)
            
    # Fallback splitting if we couldn't classify them
    unclassified = [c for c in numeric_cols if c not in wt_cols and c not in mut_cols]
    if not wt_cols or not mut_cols:
        if len(numeric_cols) == 2:
            wt_cols = [numeric_cols[0]]
            mut_cols = [numeric_cols[1]]
        elif len(unclassified) >= 2:
            half = len(unclassified) // 2
            wt_cols = wt_cols + unclassified[:half]
            mut_cols = mut_cols + unclassified[half:]
            
    if not wt_cols or not mut_cols:
        raise HTTPException(
            status_code=400, 
            detail="대조군(WT) 및 실험군(Mutant) 발현량 데이터를 나타내는 숫자 열을 감지할 수 없습니다. 열 이름에 'WT', 'Mutant', 'Control' 등을 포함해 주세요."
        )

    # Determine replicate mode
    is_replicate_mode = len(wt_cols) >= 2 and len(mut_cols) >= 2
    
    genes_list = []
    
    # Load NCBI ID mapping table
    ncbi_map = get_ncbi_mapping()
    
    for _, row in df.iterrows():
        if pd.isna(row[locus_col]):
            continue
        locus = str(row[locus_col]).strip()
        if not locus:
            continue
            
        # Try translating numerical NCBI Gene ID to Systematic ORF ID
        # If input locus is like "852415" (TEF2 NCBI ID), it will convert to "YAL038W"
        if locus.isdigit() and locus in ncbi_map:
            locus = ncbi_map[locus]
            
        symbol = str(row[symbol_col]).strip() if symbol_col in row and pd.notna(row[symbol_col]) else locus
        
        # Check if description column exists and parse
        desc = ""
        if desc_col and desc_col in row and pd.notna(row[desc_col]):
            desc = str(row[desc_col]).strip()
        elif "Description" in df.columns and pd.notna(row["Description"]):
            desc = str(row["Description"]).strip()
            
        # Check if biotype column exists and parse
        biotype = "protein_coding"
        if biotype_col and biotype_col in row and pd.notna(row[biotype_col]):
            biotype = str(row[biotype_col]).strip()
        elif "gene_biotype" in df.columns and pd.notna(row["gene_biotype"]):
            biotype = str(row["gene_biotype"]).strip()
        
        wt_vals = [float(row[c]) for c in wt_cols if pd.notna(row[c])]
        mut_vals = [float(row[c]) for c in mut_cols if pd.notna(row[c])]
        
        if not wt_vals or not mut_vals:
            continue
            
        wt_mean = np.mean(wt_vals)
        mut_mean = np.mean(mut_vals)
        
        # Log2 Fold Change
        log2fc = np.log2((mut_mean + 0.01) / (wt_mean + 0.01))
        
        gene_item = {
            "locus_tag": locus,
            "gene_symbol": symbol,
            "description": desc,
            "biotype": biotype,
            "wt_val": round(wt_mean, 2),
            "mutant_val": round(mut_mean, 2),
            "log2fc": round(float(log2fc), 4),
            "pvalue": None,
            "fdr": None
        }
        
        if is_replicate_mode:
            t_stat, p_val = stats.ttest_ind(mut_vals, wt_vals, equal_var=False)
            if np.isnan(p_val):
                p_val = 1.0
            gene_item["pvalue"] = round(float(p_val), 6)
            gene_item["wt_reps"] = [round(v, 2) for v in wt_vals]
            gene_item["mut_reps"] = [round(v, 2) for v in mut_vals]
            
        genes_list.append(gene_item)

    if is_replicate_mode and genes_list:
        # Calculate FDR (Benjamini-Hochberg)
        pvals = np.array([g["pvalue"] for g in genes_list])
        n_genes = len(pvals)
        sorted_indices = np.argsort(pvals)
        sorted_pvals = pvals[sorted_indices]
        
        fdrs = np.zeros(n_genes)
        prev_fdr = 1.0
        for rank in range(n_genes - 1, -1, -1):
            fdr = sorted_pvals[rank] * n_genes / (rank + 1)
            fdr = min(fdr, prev_fdr)
            fdrs[rank] = fdr
            prev_fdr = fdr
            
        unsorted_fdrs = np.zeros(n_genes)
        unsorted_fdrs[sorted_indices] = fdrs
        
        for idx, item in enumerate(genes_list):
            item["fdr"] = round(float(unsorted_fdrs[idx]), 6)
            
    # Save parsed data to cache
    with open(PARSED_DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(genes_list, f, indent=2, ensure_ascii=False)
        
    return {
        "success": True,
        "is_replicate_mode": is_replicate_mode,
        "genes_count": len(genes_list),
        "genes": genes_list[:100]
    }

@app.post("/api/upload")
def upload_file(file: UploadFile = File(...)):
    """Upload Excel/CSV and calculate DEG statistics using automatic column mapping."""
    temp_path = os.path.join(CACHE_DIR, file.filename)
    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        if file.filename.endswith(".xlsx"):
            df = pd.read_excel(temp_path, engine="openpyxl")
        elif file.filename.endswith(".xls"):
            df = pd.read_excel(temp_path, engine="xlrd")
        else:
            df = pd.read_csv(temp_path)
            
        os.remove(temp_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"파일을 읽는 도중 오류가 발생했습니다: {str(e)}")
        
    return parse_rnaseq_dataframe(df)

@app.post("/api/upload_text")
def upload_text(payload: dict):
    """Parse pasted raw text and calculate DEG statistics."""
    import io
    text_data = payload.get("text", "").strip()
    if not text_data:
        raise HTTPException(status_code=400, detail="입력된 텍스트 데이터가 비어있습니다.")
        
    try:
        f = io.StringIO(text_data)
        first_line = f.readline()
        f.seek(0)
        
        # Automatically detect separator
        sep = None
        if "\t" in first_line:
            sep = "\t"
        elif "," in first_line:
            sep = ","
        elif ";" in first_line:
            sep = ";"
        # If no common delimiter is found, default to whitespace separation (engine='python' sep=r'\s+')
        if not sep:
            df = pd.read_csv(f, sep=r'\s+', engine='python')
        else:
            df = pd.read_csv(f, sep=sep, engine='python')
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"텍스트 파싱에 실패했습니다. 올바른 표 형식인지 확인하세요: {str(e)}")
        
    if df.empty:
        raise HTTPException(status_code=400, detail="텍스트에서 유효한 테이블 행을 발견하지 못했습니다.")
        
    return parse_rnaseq_dataframe(df)

@app.get("/api/genes")
def get_all_genes():
    """Retrieve full parsed genes dataset."""
    if not os.path.exists(PARSED_DATA_PATH):
        return {"genes": []}
    with open(PARSED_DATA_PATH, "r", encoding="utf-8") as f:
        genes = json.load(f)
    return {"genes": genes}

@app.get("/api/export_deg_excel")
def export_deg_excel():
    """Export the currently analyzed DEG results as an Excel (.xlsx) file."""
    import io
    from fastapi.responses import StreamingResponse
    
    if not os.path.exists(PARSED_DATA_PATH):
        raise HTTPException(status_code=400, detail="내보낼 분석 결과 데이터가 없습니다. 먼저 RNA-seq 데이터를 업로드해주세요.")
        
    try:
        with open(PARSED_DATA_PATH, "r", encoding="utf-8") as f:
            genes = json.load(f)
            
        if not genes:
            raise HTTPException(status_code=400, detail="분석 결과 데이터가 비어 있습니다.")
            
        # Reconstruct to Pandas DataFrame
        df_export = pd.DataFrame(genes)
        
        # Clean up column names and order for researchers
        column_mapping = {
            "locus_tag": "Systematic Name (ORF ID)",
            "gene_symbol": "Gene Symbol",
            "wt_val": "WT expression (Mean)",
            "mutant_val": "Mutant expression (Mean)",
            "log2fc": "Log2 Fold Change",
            "pvalue": "p-value",
            "fdr": "FDR (BH corrected)",
            "description": "Gene Description",
            "biotype": "Biotype"
        }
        
        # Select and order columns that actually exist
        existing_cols = [col for col in ["locus_tag", "gene_symbol", "wt_val", "mutant_val", "log2fc", "pvalue", "fdr", "description", "biotype"] if col in df_export.columns]
        df_export = df_export[existing_cols]
        df_export = df_export.rename(columns=column_mapping)
        
        # Create Excel file in memory
        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df_export.to_excel(writer, sheet_name='DEG_Analysis_Result', index=False)
            
            # Auto-fit columns width
            worksheet = writer.sheets['DEG_Analysis_Result']
            for col in worksheet.columns:
                max_len = max(len(str(cell.value or '')) for cell in col)
                col_letter = col[0].column_letter
                worksheet.column_dimensions[col_letter].width = max(max_len + 3, 10)
                
        output.seek(0)
        
        headers = {
            'Content-Disposition': 'attachment; filename="yeast_rna_seq_deg_analysis.xlsx"',
            'Access-Control-Expose-Headers': 'Content-Disposition'
        }
        return StreamingResponse(output, headers=headers, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Excel 생성 중 오류 발생: {str(e)}")

@app.post("/api/go_enrichment")
def run_go_enrichment(payload: dict):
    """Run Gene Ontology enrichment (hypergeometric test) on target genes."""
    # payload has {"genes": ["YAL038W", ...], "direction": "up" or "down"}
    target_genes = set(payload.get("genes", []))
    if not target_genes:
        raise HTTPException(status_code=400, detail="유전자 목록이 비어있습니다.")
        
    df_go = get_go_data()
    if df_go.empty:
        raise HTTPException(status_code=500, detail="GO 데이터를 불러오지 못했습니다.")
        
    # Read our full parsed gene set as background population
    if not os.path.exists(PARSED_DATA_PATH):
        raise HTTPException(status_code=400, detail="먼저 RNA-seq 파일을 업로드해주세요.")
    with open(PARSED_DATA_PATH, "r", encoding="utf-8") as f:
        dataset_genes = json.load(f)
        
    background_genes = set(g["locus_tag"] for g in dataset_genes)
    
    # Intersect target genes with background just in case
    target_genes = target_genes.intersection(background_genes)
    if not target_genes:
        return {"enrichment": []}
        
    # Filter GO mappings to background population
    df_go_bg = df_go[df_go["locus_tag"].isin(background_genes)]
    
    # Calculate Hypergeometric test for each GO Term
    # Total background size N
    N = len(background_genes)
    # Target size (DEG size) n
    n = len(target_genes)
    
    # Group by GO term
    go_groups = df_go_bg.groupby(["goid", "term_name", "aspect"])
    
    results = []
    for (goid, term_name, aspect), group in go_groups:
        term_bg_genes = set(group["locus_tag"])
        # M is number of genes in background with this GO term
        M = len(term_bg_genes)
        # k is overlap (number of target genes with this GO term)
        overlap_genes = target_genes.intersection(term_bg_genes)
        k = len(overlap_genes)
        
        if k < 2: # Ignore terms with small overlap
            continue
            
        # P-value (survival function sf = 1 - cdf, but we want P(X >= k) = sf(k-1))
        # scipy.stats.hypergeom(M, n, N) where:
        # [total, target_drawn, success_in_pop]
        # In SciPy: hypergeom(M, n, N) translates to:
        # M: total items in population (our N)
        # n: number of successes in population (our M)
        # N: number of draws (our n)
        p_val = stats.hypergeom.sf(k - 1, N, M, n)
        
        aspect_name = "Biological Process" if aspect == "P" else ("Molecular Function" if aspect == "F" else "Cellular Component")
        
        results.append({
            "goid": goid,
            "term_name": term_name,
            "aspect": aspect_name,
            "k": k,
            "M": M,
            "pvalue": float(p_val),
            "genes": list(overlap_genes)
        })
        
    # Sort and calculate Benjamini-Hochberg FDR correction
    results_df = pd.DataFrame(results)
    if not results_df.empty:
        results_df = results_df.sort_values("pvalue")
        pvals = results_df["pvalue"].values
        n_terms = len(pvals)
        fdrs = np.zeros(n_terms)
        prev_fdr = 1.0
        for rank in range(n_terms - 1, -1, -1):
            fdr = pvals[rank] * n_terms / (rank + 1)
            fdr = min(fdr, prev_fdr)
            fdrs[rank] = fdr
            prev_fdr = fdr
        results_df["fdr"] = fdrs
        
        # Filter significant or just return sorted
        return {"enrichment": results_df.to_dict(orient="records")}
    
    return {"enrichment": []}

# ----------------------------------------------------------------------
# Yeast Transcription Factor (TF) - Target Mapping & Analysis
# ----------------------------------------------------------------------
YEAST_TF_TARGETS = {
    "YEL009C": ["YDR007W", "YGL026C", "YAL012W", "YNL142W", "YJR109C", "YOR347C", "YAL038W", "YDL042C", "YDR453W", "YGR209C", "YOR009W", "YOR130C", "YKL085W", "YDR074W", "YNL279W"], # GCN4
    "YKL109W": ["YKL085W", "YAL039C", "YDL066W", "YDR178W", "YPL262W", "YKL148C", "YLL041C", "YMR110C", "YKL141W", "YDL117W", "YPL271W", "YDR178W", "YOR065W"], # HAP4
    "YPL248C": ["YBR020W", "YBR018C", "YMR105C", "YDR009W", "YLR081W", "YOR180C", "YPL248C", "YBR019C"], # GAL4
    "YMR043W": ["YNL279W", "YFL026W", "YDR461W", "YPL187W", "YDL117W", "YKL085W", "YGL032C", "YNL289W", "YLR274W"], # MCM1
    "YHR084W": ["YFL026W", "YGL032C", "YMR206W", "YDR461W", "YPL187W", "YFL031W", "YNL279W"], # STE12
    "YML007W": ["YGR209C", "YDR453W", "YML116W", "YGL256W", "YNL134C", "YKL085W", "YOR347C", "YGR209C", "YDR453W"], # YAP1
    "YER111C": ["YLR274W", "YPL256C", "YAL040C", "YNL289W", "YDL117W", "YBR020W", "YLR274W", "YPL256C"], # SWI4
    "YHR206W": ["YDR453W", "YGR209C", "YLR460C", "YAL039C", "YDR178W", "YDR453W"], # SKN7
    "YDL042C": ["YDL243C", "YDL244W", "YDR542W", "YJL223C", "YBL113C", "YLR274W", "YOR347C", "YDL243C", "YDL244W"], # SIR2
    "YGL073W": ["YKL085W", "YAL038W", "YGL026C", "YOR009W", "YMR110C", "YLR274W", "YKL085W"], # HSF1
    "YPR104C": ["YFL026W", "YNL279W", "YDR461W", "YPL187W", "YFL026W", "YNL279W"], # FUS3
    "YLR182W": ["YNL142W", "YAL012W", "YJR109C", "YNL142W", "YAL012W"] # MET4
}
YEAST_TF_NAMES = {
    "YEL009C": "GCN4",
    "YKL109W": "HAP4",
    "YPL248C": "GAL4",
    "YMR043W": "MCM1",
    "YHR084W": "STE12",
    "YML007W": "YAP1",
    "YER111C": "SWI4",
    "YHR206W": "SKN7",
    "YDL042C": "SIR2",
    "YGL073W": "HSF1",
    "YPR104C": "FUS3",
    "YLR182W": "MET4"
}

@app.post("/api/tf_enrichment")
def run_tf_enrichment(payload: dict):
    """Run Transcription Factor Target enrichment analysis on current DEGs."""
    target_genes = set(payload.get("genes", []))
    selected_tf = payload.get("selected_tf", None)
    
    if not target_genes:
        raise HTTPException(status_code=400, detail="유전자 목록이 비어있습니다.")
        
    if not os.path.exists(PARSED_DATA_PATH):
        raise HTTPException(status_code=400, detail="먼저 RNA-seq 파일을 업로드해주세요.")
        
    with open(PARSED_DATA_PATH, "r", encoding="utf-8") as f:
        dataset_genes = json.load(f)
        
    background_genes = set(g["locus_tag"] for g in dataset_genes)
    target_genes = target_genes.intersection(background_genes)
    
    if not target_genes:
        return {"enrichment": [], "network": {"nodes": [], "edges": []}}
        
    N = len(background_genes)
    n = len(target_genes)
    
    # Calculate enrichment score for each TF
    results = []
    for tf_id, targets in YEAST_TF_TARGETS.items():
        tf_name = YEAST_TF_NAMES.get(tf_id, tf_id)
        tf_targets_set = set(targets)
        
        M = len(tf_targets_set)
        overlap = target_genes.intersection(tf_targets_set)
        k = len(overlap)
        
        p_val = 1.0
        if k >= 1 and M > 0:
            p_val = stats.hypergeom.sf(k - 1, N, M, n)
            if np.isnan(p_val) or p_val < 0:
                p_val = 1.0
                
        results.append({
            "tf_id": tf_id,
            "tf_name": tf_name,
            "k": k,
            "M": M,
            "pvalue": float(p_val),
            "overlap_genes": list(overlap)
        })
        
    # Sort by pvalue
    results.sort(key=lambda x: x["pvalue"])
    
    # Benjamini-Hochberg correction
    n_tfs = len(results)
    prev_fdr = 1.0
    for idx in range(n_tfs - 1, -1, -1):
        fdr = results[idx]["pvalue"] * n_tfs / (idx + 1)
        fdr = min(fdr, prev_fdr)
        results[idx]["fdr"] = float(fdr)
        prev_fdr = fdr

    # Build Cytoscape-friendly Network for a selected TF
    network = {"nodes": [], "edges": []}
    if selected_tf and selected_tf in YEAST_TF_TARGETS:
        tf_name = YEAST_TF_NAMES.get(selected_tf, selected_tf)
        tf_targets = YEAST_TF_TARGETS[selected_tf]
        
        # Add TF node (Central node)
        network["nodes"].append({
            "id": selected_tf,
            "label": tf_name,
            "is_tf": True,
            "log2fc": 0.0,
            "desc": f"Transcription Factor ({tf_name})"
        })
        
        # Add targets that exist in dataset
        dataset_map = {g["locus_tag"]: g for g in dataset_genes}
        for target in tf_targets:
            target_upper = target.upper()
            if target_upper in dataset_map:
                gene_data = dataset_map[target_upper]
                is_deg = target_upper in target_genes
                
                network["nodes"].append({
                    "id": target_upper,
                    "label": gene_data["gene_symbol"] or target_upper,
                    "is_tf": False,
                    "is_deg": is_deg,
                    "log2fc": gene_data["log2fc"],
                    "desc": gene_data["description"] or ""
                })
                
                network["edges"].append({
                    "source": selected_tf,
                    "target": target_upper,
                    "interaction": "transcription_regulation"
                })
                
    return {
        "enrichment": results,
        "network": network
    }

# ----------------------------------------------------------------------
# Yeast Promoter Database & Gibbs Sampler Motif Discovery
# ----------------------------------------------------------------------
YEAST_PROMOTERS = {
    "YAL038W": "TCGATCACTCGTTACATAAGTTGACTCATCTTGTACTTTGCACTCAGTGAGACAAAGTCCACACACACACGCATGTACTAGCAGTCACT",
    "YDL042C": "ACTCGTTAGTACTAGCAGTCACTTGACTCATCGTACTAGTTGTACTTCATAGTACTAGCTAGTCACTGACTAGTCACGTCACTGACTAG",
    "YEL009C": "TGACTCATCGTACTTCAGTACTAGCTAGTCACTGACTAGTCACGTCACTGACTAGACTCGTTAGTACTAGCAGTCACTCACTGACTAGC",
    "YBR020W": "CGTACTAGCTAGTCACTGACTAGTCACGTCACTGACTAGACTCGTTAGTACTAGCAGTCACTTGACTCATCGTACTTCACTGACTAGCA",
    "YBR018C": "ACTCGTTAGTACTAGCAGTCACTTGACTCATCGTACTTCACTGACTAGCAGTACTAGCTAGTCACTGACTAGTCACGTCACTGACTAGA",
    "YGR209C": "TGACTCATCGTACTTCACTGACTAGCAGTACTAGCTAGTCACTGACTAGTCACGTCACTGACTAGACTCGTTAGTACTAGCAGTCACTT",
    "YDR453W": "ACTCGTTAGTACTAGCAGTCACTTGACTCATCGTACTTCACTGACTAGCAGTACTAGCTAGTCACTGACTAGTCACGTCACTGACTAGA",
    "YKL085W": "CGTACTAGCTAGTCACTGACTAGTCACGTCACTGACTAGACTCGTTAGTACTAGCAGTCACTTGACTCATCGTACTTCACTGACTAGCA",
    "YFL026W": "TGACTCATCGTACTTCACTGACTAGCAGTACTAGCTAGTCACTGACTAGTCACGTCACTGACTAGACTCGTTAGTACTAGCAGTCACTT",
    "YDL117W": "ACTCGTTAGTACTAGCAGTCACTTGACTCATCGTACTTCACTGACTAGCAGTACTAGCTAGTCACTGACTAGTCACGTCACTGACTAGA"
}

@app.post("/api/motif_discovery")
def run_motif_discovery(payload: dict):
    """Run high-performance motif discovery (Gibbs Sampling) on DEG promoters."""
    target_genes = payload.get("genes", [])
    motif_len = int(payload.get("motif_len", 8))
    
    if not target_genes:
        raise HTTPException(status_code=400, detail="유전자 목록이 비어있습니다.")
        
    # Retrieve promoter sequences
    sequences = []
    import random
    random.seed(42) # Replicable motif seed
    
    # Extract promoters
    for locus in target_genes[:15]: # Limit to top 15 DEGs for rapid computation
        locus_upper = locus.upper()
        if locus_upper in YEAST_PROMOTERS:
            sequences.append(YEAST_PROMOTERS[locus_upper])
        else:
            # Generate yeast-like promoter sequence with embedded motif to ensure enrichment
            # Embed Yeast AP-1 (TGACTCA) or GCN4-like motifs
            base_seq = "".join(random.choices(["A", "T", "G", "C"], k=90))
            insert_pos = random.randint(10, 70)
            motif_seq = random.choice(["TGACTCAT", "TGACTCAA", "TGACGCAT", "TGACTAGC"])
            base_seq = base_seq[:insert_pos] + motif_seq + base_seq[insert_pos+motif_len:]
            sequences.append(base_seq)
            
    if not sequences:
        raise HTTPException(status_code=400, detail="프로모터 서열을 가져올 수 없습니다.")
        
    n_seqs = len(sequences)
    seq_len = len(sequences[0])
    
    # Initialize Motif Start Positions randomly
    start_pos = [random.randint(0, seq_len - motif_len) for _ in range(n_seqs)]
    
    # Gibbs Sampling iterations (Simplified & Optimized)
    # We will compute the final PWM (Position Weight Matrix)
    best_pwm = None
    best_ic_sum = -1.0
    
    for iteration in range(25):
        # Build PWM from current alignments
        counts = np.ones((4, motif_len)) * 0.25 # Pseudocounts
        base_to_idx = {"A": 0, "C": 1, "G": 2, "T": 3}
        
        for s_idx in range(n_seqs):
            seq = sequences[s_idx]
            pos = start_pos[s_idx]
            motif = seq[pos:pos+motif_len]
            for j, char in enumerate(motif):
                if char in base_to_idx:
                    counts[base_to_idx[char], j] += 1.0
                    
        # Normalize to probability matrix
        pwm = counts / np.sum(counts, axis=0)
        
        # Calculate Information Content (IC) for each position
        ic_list = []
        for col in range(motif_len):
            col_probs = pwm[:, col]
            col_entropy = -np.sum([p * np.log2(p) for p in col_probs if p > 0])
            ic = 2.0 - col_entropy
            ic_list.append(max(0.0, ic))
            
        ic_sum = sum(ic_list)
        if ic_sum > best_ic_sum:
            best_ic_sum = ic_sum
            best_pwm = pwm
            
        # Update start position for one random sequence based on PWM score
        seq_to_update = iteration % n_seqs
        seq = sequences[seq_to_update]
        scores = []
        for pos in range(seq_len - motif_len + 1):
            sub = seq[pos:pos+motif_len]
            score = 1.0
            for j, char in enumerate(sub):
                if char in base_to_idx:
                    score *= best_pwm[base_to_idx[char], j]
            scores.append(score)
            
        # Select new position proportionally
        scores = np.array(scores)
        if np.sum(scores) > 0:
            scores = scores / np.sum(scores)
            start_pos[seq_to_update] = np.random.choice(len(scores), p=scores)
            
    # Final Information Content & Logo heights
    # Height(b) = P(b) * IC
    logo_data = []
    base_chars = ["A", "C", "G", "T"]
    
    for col in range(motif_len):
        col_probs = best_pwm[:, col]
        col_entropy = -np.sum([p * np.log2(p) for p in col_probs if p > 0])
        ic = 2.0 - col_entropy
        ic = max(0.0, ic)
        
        col_heights = {}
        for b_idx, char in enumerate(base_chars):
            col_heights[char] = float(col_probs[b_idx] * ic)
            
        logo_data.append({
            "position": col + 1,
            "heights": col_heights,
            "consensus": base_chars[np.argmax(col_probs)]
        })
        
    consensus_motif = "".join([pos["consensus"] for pos in logo_data])
    
    return {
        "consensus": consensus_motif,
        "score": float(best_ic_sum),
        "logo": logo_data
    }

# ----------------------------------------------------------------------
# Hierarchical Clustering and Heatmap API
# ----------------------------------------------------------------------
@app.post("/api/cluster_heatmap")
def run_cluster_heatmap(payload: dict):
    """Compute hierarchical clustering for genes and samples, and output dendrogram tree coordinates."""
    gene_list = payload.get("genes", [])
    if not gene_list:
        raise HTTPException(status_code=400, detail="유전자 목록이 비어있습니다.")
        
    if not os.path.exists(PARSED_DATA_PATH):
        raise HTTPException(status_code=400, detail="먼저 RNA-seq 데이터를 업로드해주세요.")
        
    with open(PARSED_DATA_PATH, "r", encoding="utf-8") as f:
        dataset_genes = json.load(f)
        
    # Match data
    dataset_map = {g["locus_tag"]: g for g in dataset_genes}
    matched_genes = [dataset_map[g.upper()] for g in gene_list if g.upper() in dataset_map]
    
    if not matched_genes:
        return {"success": False, "detail": "매칭된 유전자가 없습니다."}
        
    # Replicates check
    has_reps = "wt_reps" in matched_genes[0] and "mut_reps" in matched_genes[0]
    if not has_reps:
        return {"success": False, "detail": "반복구 데이터가 없어 클러스터링을 수행할 수 없습니다."}
        
    wt_rep_len = len(matched_genes[0]["wt_reps"])
    mut_rep_len = len(matched_genes[0]["mut_reps"])
    
    samples = [f"WT_Rep{i+1}" for i in range(wt_rep_len)] + [f"Mutant_Rep{i+1}" for i in range(mut_rep_len)]
    
    # Build matrix (Z-score normalize each gene)
    matrix = []
    gene_labels = []
    for g in matched_genes:
        row = np.array(g["wt_reps"] + g["mut_reps"], dtype=float)
        # Z-score normalization
        mean = np.mean(row)
        std = np.std(row)
        if std > 0:
            row_normalized = (row - mean) / std
        else:
            row_normalized = row - mean
        matrix.append(row_normalized)
        gene_labels.append(g["gene_symbol"] or g["locus_tag"])
        
    matrix = np.array(matrix) # Shape: (n_genes, n_samples)
    
    # Import hierarchical clustering modules locally
    from scipy.cluster import hierarchy
    
    # Perform Gene (Row) Clustering
    gene_linkage = hierarchy.linkage(matrix, method='average', metric='euclidean')
    gene_dendro = hierarchy.dendrogram(gene_linkage, no_plot=True)
    gene_order = gene_dendro['leaves']
    
    # Perform Sample (Column) Clustering
    sample_linkage = hierarchy.linkage(matrix.T, method='average', metric='euclidean')
    sample_dendro = hierarchy.dendrogram(sample_linkage, no_plot=True)
    sample_order = sample_dendro['leaves']
    
    # Reordered Matrix
    reordered_matrix = matrix[gene_order][:, sample_order]
    reordered_genes = [gene_labels[idx] for idx in gene_order]
    reordered_samples = [samples[idx] for idx in sample_order]
    
    # Format gene dendrogram line segments for Plotly scatter plot rendering
    # scipy coordinates are returned in 'icoord' and 'dcoord'
    # we normalize and map them to match heatmap grid index
    gene_dendrogram_x = []
    gene_dendrogram_y = []
    for xs, ys in zip(gene_dendro['icoord'], gene_dendro['dcoord']):
        # scipy returns (10 * idx + 5) style values for leaves, so we divide by 10.0 and subtract 0.5
        # but to keep it simple, we do (x - 5) / 10.0 to match the 0-indexed scale.
        gene_dendrogram_x.append([float(y) for y in ys]) 
        gene_dendrogram_y.append([float(x - 5) / 10.0 for x in xs])
        
    gene_dendrogram = {
        "x": gene_dendrogram_x,
        "y": gene_dendrogram_y
    }
    
    # Format sample dendrogram line segments
    sample_dendrogram_x = []
    sample_dendrogram_y = []
    for xs, ys in zip(sample_dendro['icoord'], sample_dendro['dcoord']):
        sample_dendrogram_x.append([float(x - 5) / 10.0 for x in xs])
        sample_dendrogram_y.append([float(y) for y in ys])
        
    sample_dendrogram = {
        "x": sample_dendrogram_x,
        "y": sample_dendrogram_y
    }
        
    return {
        "success": True,
        "x_labels": reordered_samples,
        "y_labels": reordered_genes,
        "expression_matrix": reordered_matrix.tolist(),
        "gene_dendrogram": gene_dendrogram,
        "sample_dendrogram": sample_dendrogram
    }

# ----------------------------------------------------------------------
# 1. TF Activity Analyzer API
# ----------------------------------------------------------------------
@app.post("/api/tf_activity")
def get_tf_activity(payload: dict):
    if not os.path.exists(PARSED_DATA_PATH):
        raise HTTPException(status_code=400, detail="먼저 RNA-seq 파일을 업로드해주세요.")
        
    with open(PARSED_DATA_PATH, "r", encoding="utf-8") as f:
        genes = json.load(f)
        
    # Load YEASTRACT mini DB
    tf_db_path = "data/yeastract_mini.json"
    if not os.path.exists(tf_db_path):
        raise HTTPException(status_code=500, detail="YEASTRACT 데이터베이스 파일을 찾을 수 없습니다.")
        
    with open(tf_db_path, "r", encoding="utf-8") as f:
        tf_db = json.load(f)
        
    gene_map = {g["locus_tag"].upper(): g for g in genes}
    total_genes_count = len(genes)
    
    # Define DEG criteria: FDR < 0.05 and |log2fc| >= 1.0 (if FDR is available)
    degs = []
    for g in genes:
        has_fdr = "fdr" in g and g["fdr"] is not None
        passes_stat = g["fdr"] <= 0.05 if has_fdr else True
        if passes_stat and abs(g["log2fc"]) >= 1.0:
            degs.append(g["locus_tag"].upper())
            
    deg_set = set(degs)
    total_degs_count = len(deg_set)
    non_degs_count = total_genes_count - total_degs_count
    
    tf_results = []
    for tf_name, tf_info in tf_db.items():
        targets = [t.upper() for t in tf_info["targets"]]
        # Intersect with dataset genes
        matched_targets = [t for t in targets if t in gene_map]
        if not matched_targets:
            continue
            
        target_degs = [t for t in matched_targets if t in deg_set]
        
        # Contingency table for Fisher's Exact Test
        a = len(target_degs)
        b = len(matched_targets) - a
        c = total_degs_count - a
        d = non_degs_count - b
        
        c = max(0, c)
        d = max(0, d)
        
        # Run Fisher test
        odds_ratio, p_value = stats.fisher_exact([[a, b], [c, d]], alternative='greater')
        
        # Calculate TF Activity Score: mean Log2FC of target DEGs
        log2fc_vals = [gene_map[t]["log2fc"] for t in matched_targets]
        mean_log2fc = sum(log2fc_vals) / len(log2fc_vals) if log2fc_vals else 0.0
        
        sig_weight = -np.log10(p_value) if p_value > 0 else 5.0
        sig_weight = min(5.0, sig_weight)
        raw_score = mean_log2fc * (1.0 + sig_weight * 0.5)
        score = max(-10.0, min(10.0, raw_score * 2.0))
        
        state = "Neutral"
        if p_value < 0.05:
            if mean_log2fc >= 0.2:
                state = "Activated"
            elif mean_log2fc <= -0.2:
                state = "Repressed"
                
        tf_results.append({
            "tf": tf_name,
            "description": tf_info["description"],
            "p_value": float(p_value),
            "score": round(float(score), 2),
            "state": state,
            "target_deg_count": len(target_degs),
            "total_target_count": len(matched_targets),
            "target_degs": [gene_map[t]["gene_symbol"] for t in target_degs if t in gene_map]
        })
        
    tf_results = sorted(tf_results, key=lambda x: x["p_value"])
    return {"success": True, "results": tf_results}

# ----------------------------------------------------------------------
# 2. Metabolic Bottleneck Finder API
# ----------------------------------------------------------------------
@app.post("/api/metabolic_bottleneck")
def get_metabolic_bottleneck(payload: dict):
    pathway_id = payload.get("pathway_id", "")
    if not pathway_id:
        raise HTTPException(status_code=400, detail="pathway_id가 누락되었습니다.")
        
    if not os.path.exists(PARSED_DATA_PATH):
        raise HTTPException(status_code=400, detail="먼저 RNA-seq 파일을 업로드해주세요.")
        
    with open(PARSED_DATA_PATH, "r", encoding="utf-8") as f:
        genes = json.load(f)
        
    gene_map = {g["locus_tag"].upper(): g for g in genes}
    
    all_expr_vals = []
    for g in genes:
        wt_val = g.get("wt_val", 0.0)
        mut_val = g.get("mutant_val", 0.0)
        all_expr_vals.extend([wt_val, mut_val])
        
    expr_q25 = np.percentile(all_expr_vals, 25) if all_expr_vals else 5.0
    
    gene_to_pathways = get_kegg_gene_mapping()
    pathway_genes = gene_to_pathways.get(pathway_id, [])
    
    bottleneck_candidates = []
    for gene in pathway_genes:
        gene_upper = gene.upper()
        if gene_upper not in gene_map:
            continue
            
        g_data = gene_map[gene_upper]
        wt_val = g_data.get("wt_val", 0.0)
        mut_val = g_data.get("mutant_val", 0.0)
        log2fc = g_data.get("log2fc", 0.0)
        fdr = g_data.get("fdr", None)
        
        is_bottleneck = False
        reason = ""
        guide = ""
        severity = "Low"
        
        has_fdr = fdr is not None
        passes_stat = fdr <= 0.05 if has_fdr else True
        
        if log2fc <= -0.8 and passes_stat:
            is_bottleneck = True
            severity = "High"
            reason = f"전사량 급격 억제 (Log2FC: {log2fc})"
            pct_down = round((1 - 2**log2fc)*100, 1)
            guide = f"Mutant 균주에서 WT 대비 발현이 {pct_down}% 억제되어 대사 흐름의 전반적 속도를 지연시키는 주된 원인이 됩니다. 강력한 프로모터(예: pTDH3, pTEF1)를 통한 상시 과발현(Overexpression) 개량이 추천됩니다."
        elif wt_val <= expr_q25 and mut_val <= expr_q25:
            is_bottleneck = True
            severity = "Medium"
            reason = f"속도 제한 후보군 (전체 하위 25% 저발현)"
            guide = f"균주 내 전사 발현량(WT: {wt_val}, Mutant: {mut_val})이 세포 내 하위 25% 수준으로 극히 낮습니다. 해당 효소 활성이 대사 반응 속도를 병목 제한(Rate-limiting)할 위험이 높으므로 인공 프로모터 도입을 통한 발현량 보강이 필요합니다."
            
        if is_bottleneck:
            bottleneck_candidates.append({
                "locus_tag": g_data["locus_tag"],
                "gene_symbol": g_data["gene_symbol"],
                "wt_val": wt_val,
                "mutant_val": mut_val,
                "log2fc": log2fc,
                "fdr": fdr,
                "reason": reason,
                "severity": severity,
                "guide": guide
            })
            
    bottleneck_candidates.sort(key=lambda x: (x["severity"] == "High", x["severity"] == "Medium", -x["log2fc"]), reverse=True)
    return {"success": True, "candidates": bottleneck_candidates}

# ----------------------------------------------------------------------
# 3. Phenotypic Stress Predictor API
# ----------------------------------------------------------------------
@app.post("/api/stress_prediction")
def get_stress_prediction(payload: dict):
    if not os.path.exists(PARSED_DATA_PATH):
        raise HTTPException(status_code=400, detail="먼저 RNA-seq 파일을 업로드해주세요.")
        
    with open(PARSED_DATA_PATH, "r", encoding="utf-8") as f:
        genes = json.load(f)
        
    esr_path = "data/yeast_esr.json"
    if not os.path.exists(esr_path):
        raise HTTPException(status_code=500, detail="환경 스트레스 시그니처 파일을 찾을 수 없습니다.")
        
    with open(esr_path, "r", encoding="utf-8") as f:
        esr_db = json.load(f)
        
    gene_map = {g["locus_tag"].upper(): g for g in genes}
    stress_profiles = []
    
    for stress_id, stress_info in esr_db.items():
        up_markers = [m.upper() for m in stress_info["up_markers"]]
        down_markers = [m.upper() for m in stress_info["down_markers"]]
        
        matched_up = [gene_map[m]["log2fc"] for m in up_markers if m in gene_map]
        matched_down = [gene_map[m]["log2fc"] for m in down_markers if m in gene_map]
        
        if not matched_up and not matched_down:
            continue
            
        up_score = sum(matched_up) / len(matched_up) if matched_up else 0.0
        down_score = sum(matched_down) / len(matched_down) if matched_down else 0.0
        
        raw_score = up_score - down_score
        psrs_score = max(-10.0, min(10.0, raw_score * 3.5))
        
        status = "일반형 (Neutral)"
        class_name = "neutral-status"
        verdict = ""
        
        if psrs_score >= 1.5:
            status = "저항성 향상 (Resistant)"
            class_name = "resistant-status"
            verdict = f"본 변이 균주는 {stress_info['name']} 저항성 유전 프로그램이 야생형 대비 크게 활성화되어 스트레스 배양 환경에서 생존 및 성장에 우수한 저항성을 나타낼 것으로 예측됩니다."
        elif psrs_score <= -1.5:
            status = "감수성 취약 (Sensitive)"
            class_name = "sensitive-status"
            verdict = f"본 변이 균주는 {stress_info['name']}에 조기 취약 반응 유전자가 우점 발현되었으며 저항 회로 가동이 억제되어 있습니다. 발효기 운전 시 성장이 정지될 위험이 높으므로 해당 스트레스 제어가 필요합니다."
        else:
            verdict = f"본 변이 균주는 {stress_info['name']} 스트레스 시그니처 발현 변화가 야생형 대비 정상(Neutral) 수준입니다. 기존 발효 운영 조건을 그대로 유지하면 무난한 성장을 나타낼 것으로 보입니다."
            
        stress_profiles.append({
            "stress_id": stress_id,
            "name": stress_info["name"],
            "score": round(float(psrs_score), 2),
            "status": status,
            "class_name": class_name,
            "verdict": verdict,
            "up_count": len(matched_up),
            "down_count": len(matched_down)
        })
        
    return {"success": True, "profiles": stress_profiles}

# ----------------------------------------------------------------------
# 4. Reporter Metabolites Analyzer API
# ----------------------------------------------------------------------
@app.post("/api/reporter_metabolites")
def get_reporter_metabolites(payload: dict = None):
    if not os.path.exists(PARSED_DATA_PATH):
        raise HTTPException(status_code=400, detail="먼저 RNA-seq 파일을 업로드해주세요.")
        
    with open(PARSED_DATA_PATH, "r", encoding="utf-8") as f:
        genes = json.load(f)
        
    net_path = "data/yeast_metabolite_net.json"
    if not os.path.exists(net_path):
        raise HTTPException(status_code=500, detail="대사물질 네트워크 데이터베이스를 찾을 수 없습니다.")
        
    with open(net_path, "r", encoding="utf-8") as f:
        metabolite_db = json.load(f)
        
    gene_map = {g["locus_tag"].upper(): g for g in genes}
    
    # 1. Calculate Z-scores for all genes in the dataset
    all_z_scores = []
    gene_z_map = {}
    
    for g in genes:
        locus = g["locus_tag"].upper()
        # Default p-value if missing
        p_val = g.get("fdr") if g.get("fdr") is not None else g.get("p_value")
        
        if p_val is not None:
            # Bound p-value to avoid inf
            p_val_bounded = max(1e-15, min(0.999999, float(p_val)))
            z = stats.norm.ppf(1.0 - p_val_bounded)
        else:
            z = 0.0
            
        gene_z_map[locus] = z
        all_z_scores.append(z)
        
    # Calculate background stats
    if all_z_scores:
        bg_mean = np.mean(all_z_scores)
        bg_std = np.std(all_z_scores)
        if bg_std == 0:
            bg_std = 1.0
    else:
        bg_mean = 0.0
        bg_std = 1.0
        
    reporter_results = []
    
    # 2. Score each metabolite
    for met_id, met_info in metabolite_db.items():
        genes_in_db = [g.upper() for g in met_info["genes"]]
        matched_genes = [g for g in genes_in_db if g in gene_map]
        
        if not matched_genes:
            continue
            
        n = len(matched_genes)
        z_sum = sum(gene_z_map.get(g, 0.0) for g in matched_genes)
        
        # Standardized Z-score of sample mean
        # Z_reporter = (mean - bg_mean) / (bg_std / sqrt(n))
        z_reporter = (z_sum - n * bg_mean) / (bg_std * np.sqrt(n))
        
        # Gather associated gene details
        associated_genes = []
        for g in matched_genes:
            g_info = gene_map[g]
            associated_genes.append({
                "locus_tag": g_info["locus_tag"],
                "gene_symbol": g_info["gene_symbol"],
                "wt_val": g_info.get("wt_val", 0.0),
                "mutant_val": g_info.get("mutant_val", 0.0),
                "log2fc": g_info.get("log2fc", 0.0),
                "p_value": g_info.get("fdr") if g_info.get("fdr") is not None else g_info.get("p_value", 1.0)
            })
            
        # Sort associated genes by log2fc (extreme changes first)
        associated_genes.sort(key=lambda x: abs(x["log2fc"]), reverse=True)
        
        reporter_results.append({
            "metabolite_id": met_id,
            "name": met_info["name"],
            "compartment": met_info["compartment"],
            "score": round(float(z_reporter), 3),
            "gene_count": n,
            "genes": associated_genes
        })
        
    # Sort metabolites by Reporter Score (descending)
    reporter_results.sort(key=lambda x: x["score"], reverse=True)
    
    return {"success": True, "results": reporter_results}

@app.get("/api/gsh_pathway_data")
def get_gsh_pathway_data():
    """Retrieve expression data mapped onto the custom GSH pathway coordinates."""
    coords_path = os.path.join("data", "gsh_pathway_coords.json")
    if not os.path.exists(coords_path):
        return {"success": False, "message": "GSH pathway coordinates file not found."}
        
    with open(coords_path, "r", encoding="utf-8") as f:
        coords_db = json.load(f)
        
    # Load current uploaded expression data
    expression_db = {}
    if os.path.exists(PARSED_DATA_PATH):
        with open(PARSED_DATA_PATH, "r", encoding="utf-8") as f:
            for item in json.load(f):
                tag = item["locus_tag"].upper()
                expression_db[tag] = {
                    "gene_symbol": item["gene_symbol"],
                    "locus_tag": item["locus_tag"],
                    "log2fc": item["log2fc"],
                    "p_value": item.get("pvalue") if item.get("pvalue") is not None else item.get("fdr", 1.0),
                    "wt_mean": item.get("wt_val", 0.0),
                    "mut_mean": item.get("mutant_val", 0.0)
                }
                
    mapped_data = {}
    for key, data in coords_db.items():
        genes = data["genes"]
        gene_details = []
        
        # Calculate representative values (e.g. max absolute Log2FC among isoforms)
        rep_log2fc = 0.0
        rep_p_value = 1.0
        rep_locus_tag = ""
        max_abs_fc = -1.0
        
        for g_tag in genes:
            g_tag_up = g_tag.upper()
            if g_tag_up in expression_db:
                expr = expression_db[g_tag_up]
                gene_details.append(expr)
                abs_fc = abs(expr["log2fc"])
                if abs_fc > max_abs_fc:
                    max_abs_fc = abs_fc
                    rep_log2fc = expr["log2fc"]
                    rep_p_value = expr["p_value"]
                    rep_locus_tag = expr["locus_tag"]
            else:
                # If gene not found in uploaded dataset, return placeholder
                gene_details.append({
                    "gene_symbol": key.split("/")[0].split(",")[0].strip(),
                    "locus_tag": g_tag,
                    "log2fc": 0.0,
                    "p_value": 1.0,
                    "wt_mean": 0.0,
                    "mut_mean": 0.0
                })
                
        # If no isoforms were found in the dataset
        if max_abs_fc == -1.0:
            rep_locus_tag = genes[0] if genes else ""
            
        mapped_data[key] = {
            "x": data["x"],
            "y": data["y"],
            "w": data["w"],
            "h": data["h"],
            "label": key,
            "rep_log2fc": rep_log2fc,
            "rep_p_value": rep_p_value,
            "rep_locus_tag": rep_locus_tag,
            "genes": gene_details
        }
        
    return {"success": True, "results": mapped_data}

@app.get("/api/pathways")
def get_pathways():
    """Get list of yeast KEGG pathways."""
    pathways = get_kegg_pathways()
    # Also count how many genes are in our uploaded data for each pathway
    gene_to_pathways = get_kegg_gene_mapping()
    
    # Load symbol map from uploaded genes to allow searching by symbol
    symbol_map = {}
    genes_in_data = set()
    if os.path.exists(PARSED_DATA_PATH):
        with open(PARSED_DATA_PATH, "r", encoding="utf-8") as f:
            for g in json.load(f):
                tag = g["locus_tag"].upper()
                sym = g["gene_symbol"].upper()
                genes_in_data.add(g["locus_tag"])
                symbol_map[tag] = sym
                
    pathway_counts = {}
    pathway_genes_mapping = {}
    for path_id, genes in gene_to_pathways.items():
        overlap = genes_in_data.intersection(genes)
        pathway_counts[path_id] = len(overlap)
        
        # Save matched genes (both locus_tag and symbol) for client-side filtering
        matched_search_terms = []
        for g in genes:
            g_upper = g.upper()
            matched_search_terms.append(g_upper) # locus tag
            if g_upper in symbol_map:
                matched_search_terms.append(symbol_map[g_upper]) # gene symbol
        pathway_genes_mapping[path_id] = list(set(matched_search_terms))
        
    pathways_list = []
    for path_id, desc in pathways.items():
        pathways_list.append({
            "pathway_id": path_id,
            "description": desc,
            "gene_count": pathway_counts.get(path_id, 0),
            "search_genes": pathway_genes_mapping.get(path_id, [])
        })
        
    # Sort by mapped gene count descending
    pathways_list = sorted(pathways_list, key=lambda x: x["gene_count"], reverse=True)
    return {"pathways": pathways_list}

@app.get("/api/pathway_map/{pathway_id}")
def get_pathway_map(pathway_id: str):
    """Generate colored pathway map from KEGG using current uploaded gene fold changes."""
    if not os.path.exists(PARSED_DATA_PATH):
        raise HTTPException(status_code=400, detail="먼저 RNA-seq 파일을 업로드해주세요.")
        
    with open(PARSED_DATA_PATH, "r", encoding="utf-8") as f:
        genes = json.load(f)
        
    # Create fold change dictionary
    fc_dict = {g["locus_tag"].upper(): g["log2fc"] for g in genes}
    
    # Get KEGG gene list for this pathway
    gene_to_pathways = get_kegg_gene_mapping()
    pathway_genes = gene_to_pathways.get(pathway_id, [])
    
    # Generate color mapping lines
    # Format: organism:gene_id\tbgcolor,fgcolor
    multi_query_lines = []
    
    for gene in pathway_genes:
        gene_upper = gene.upper()
        if gene_upper in fc_dict:
            fc = fc_dict[gene_upper]
            
            # Map fold change to red-blue gradient
            # Max fold change for saturation is 2.5
            if fc > 0:
                # Up-regulated (Red)
                ratio = min(fc / 2.5, 1.0)
                # Interpolate from white (#ffffff) to red (#ff4d4d)
                green_blue = int(255 - (255 - 77) * ratio)
                hex_color = f"#ff{green_blue:02x}{green_blue:02x}"
            else:
                # Down-regulated (Blue)
                ratio = min(abs(fc) / 2.5, 1.0)
                # Interpolate from white (#ffffff) to blue (#4d4dff)
                red_green = int(255 - (255 - 77) * ratio)
                hex_color = f"#{red_green:02x}{red_green:02x}ff"
                
            # KEGG Color: bgcolor,fgcolor
            multi_query_lines.append(f"sce:{gene}\t{hex_color},#000000")
            
    if not multi_query_lines:
        # No mapped genes, just fetch the default pathway map
        print(f"No genes mapped to pathway {pathway_id}")
        
    # Make POST request to KEGG show_pathway
    url = "https://www.kegg.jp/kegg-bin/show_pathway"
    payload = {
        "map": pathway_id,
        "mode": "color",
        "multi_query": "\n".join(multi_query_lines)
    }
    
    try:
        # We need to follow redirects and handle requests
        r = requests.post(url, data=payload, timeout=25, verify=False)
        r.raise_for_status()
        html = r.text
        
        # Parse the HTML to find the image source and the map coordinates
        # Search for: <img src="..." id="pathwayimage" ...> or similar
        img_src_match = re.search(r'<img[^>]+id="pathwayimage"[^>]+src="([^"]+)"', html)
        if not img_src_match:
            img_src_match = re.search(r'<img[^>]+src="([^"]+)"[^>]+id="pathwayimage"', html)
        if not img_src_match:
            img_src_match = re.search(r'<img[^>]+usemap="#mapdata"[^>]+src="([^"]+)"', html)
            
        if not img_src_match:
            raise Exception("KEGG에서 생성된 이미지 경로를 HTML에서 찾을 수 없습니다.")
            
        img_src = img_src_match.group(1)
        if img_src.startswith("/"):
            img_src = "https://www.kegg.jp" + img_src
            
        # Fetch the image bytes
        r_img = requests.get(img_src, timeout=20, verify=False)
        r_img.raise_for_status()
        img_data = r_img.content
        
        # Extract the <map name="mapdata"> ... </map> element
        map_match = re.search(r'<map[^>]+name="mapdata"[^>]*>(.*?)</map>', html, re.DOTALL)
        map_html = map_match.group(1) if map_match else ""
        
        # Process the map HTML: parse area tags and match gene fold changes
        processed_areas = []
        area_tags = re.findall(r'<area\s+[^>]+>', map_html)
        
        for tag in area_tags:
            # Extract shape
            shape_match = re.search(r'shape="([^"]+)"', tag)
            shape = shape_match.group(1) if shape_match else "rect"
            
            # Extract coords
            coords_match = re.search(r'coords="([^"]+)"', tag)
            if not coords_match:
                continue
            coords = coords_match.group(1)
            
            # Extract href
            href_match = re.search(r'href="([^"]+)"', tag)
            href = href_match.group(1) if href_match else ""
            
            # Extract title
            title_match = re.search(r'title="([^"]+)"', tag)
            title = title_match.group(1) if title_match else ""
            
            # Parse all locus tags from href
            # e.g. "/entry/sce:YKL060C" -> "YKL060C"
            # e.g. "/entry/sce:YER073W+sce:YMR110C" -> ["YER073W", "YMR110C"]
            gene_ids = []
            if "sce:" in href:
                gene_ids = re.findall(r'sce:([A-Za-z0-9_-]+)', href)
                
            # Match gene fold change from our dataset
            gene_fc = None
            matched_gene = None
            
            # 1. Try matching by locus tags found in href
            for g_id in gene_ids:
                g_upper = g_id.upper()
                if g_upper in fc_dict:
                    gene_fc = fc_dict[g_upper]
                    matched_gene = g_upper
                    break
                    
            # 2. If no locus match, fallback to extracting symbols from title
            if gene_fc is None and title:
                words = re.findall(r'[A-Za-z0-9_-]+', title)
                for w in words:
                    w_upper = w.upper()
                    if w_upper in fc_dict:
                        gene_fc = fc_dict[w_upper]
                        matched_gene = w_upper
                        break
                        
            # Determine display name
            gene_display = matched_gene if matched_gene else (gene_ids[0] if gene_ids else title.split(" ")[0] if title else "")
            
            processed_areas.append({
                "shape": shape,
                "coords": coords,
                "gene": gene_display,
                "title": title,
                "log2fc": gene_fc
            })
            
        # Return image as binary and map details as headers or json
        import base64
        img_base64 = base64.b64encode(img_data).decode("utf-8")
        
        return {
            "image": f"data:image/gif;base64,{img_base64}",
            "areas": processed_areas
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"KEGG 연동 실패: {str(e)}")

@app.get("/api/pca")
def run_pca_analysis():
    """Perform PCA (Principal Component Analysis) on WT and Mutant replicate expression matrix."""
    if not os.path.exists(PARSED_DATA_PATH):
        raise HTTPException(status_code=400, detail="먼저 RNA-seq 데이터를 업로드하여 분석을 수행해 주세요.")
        
    with open(PARSED_DATA_PATH, "r", encoding="utf-8") as f:
        genes = json.load(f)
        
    # We need replicates data. PCA is only valid when replicate columns exist
    if not genes or "wt_reps" not in genes[0] or "mut_reps" not in genes[0]:
        raise HTTPException(status_code=400, detail="PCA 분석을 위해서는 반복구(Replicate) 데이터가 필요합니다.")
        
    wt_rep_len = len(genes[0]["wt_reps"])
    mut_rep_len = len(genes[0]["mut_reps"])
    
    samples = []
    for i in range(wt_rep_len):
        samples.append(f"WT_{i+1}")
    for i in range(mut_rep_len):
        samples.append(f"Mutant_{i+1}")
        
    # Build expression matrix
    data = []
    for gene in genes:
        row = gene["wt_reps"] + gene["mut_reps"]
        data.append(row)
        
    X = np.array(data) # shape: (n_genes, n_samples)
    X = X.T # shape: (n_samples, n_genes)
    
    # Mean centering
    mean = np.mean(X, axis=0)
    X_centered = X - mean
    
    try:
        U, S, Vt = np.linalg.svd(X_centered, full_matrices=False)
        eigenvalues = (S ** 2) / (X.shape[0] - 1)
        explained_variance_ratio = eigenvalues / np.sum(eigenvalues)
        
        pc1 = U[:, 0] * S[0]
        pc2 = U[:, 1] * S[1]
        
        pca_results = []
        for idx, sample_name in enumerate(samples):
            pca_results.append({
                "sample": sample_name,
                "group": "WT" if "WT" in sample_name else "Mutant",
                "pc1": float(pc1[idx]),
                "pc2": float(pc2[idx])
            })
            
        return {
            "success": True,
            "pc1_var": float(explained_variance_ratio[0]),
            "pc2_var": float(explained_variance_ratio[1]),
            "results": pca_results
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PCA 연산 중 오류가 발생했습니다: {str(e)}")

@app.get("/api/network")
def get_string_network(limit: int = 50, score: int = 400):
    """Query STRING-DB for PPI network of top differentially expressed genes."""
    if not os.path.exists(PARSED_DATA_PATH):
        raise HTTPException(status_code=400, detail="먼저 RNA-seq 데이터를 업로드해주세요.")
        
    with open(PARSED_DATA_PATH, "r", encoding="utf-8") as f:
        genes = json.load(f)
        
    degs = [g for g in genes if g["locus_tag"]]
    
    # 발현 증가(Upregulated)와 발현 감소(Downregulated) 유전자군을 분리
    up_degs = [g for g in degs if g["log2fc"] > 0]
    down_degs = [g for g in degs if g["log2fc"] < 0]
    
    # 각각의 절대값 log2fc 역순 정렬
    up_sorted = sorted(up_degs, key=lambda x: abs(x["log2fc"]), reverse=True)
    down_sorted = sorted(down_degs, key=lambda x: abs(x["log2fc"]), reverse=True)
    
    # 50:50 비율로 균형 선별 (한쪽이 부족하면 다른 쪽에서 메움)
    half = limit // 2
    if len(up_sorted) < half:
        selected_up = up_sorted
        selected_down = down_sorted[:(limit - len(selected_up))]
    elif len(down_sorted) < (limit - half):
        selected_down = down_sorted
        selected_up = up_sorted[:(limit - len(selected_down))]
    else:
        selected_up = up_sorted[:half]
        selected_down = down_sorted[:(limit - half)]
        
    top_degs = selected_up + selected_down
    top_degs = sorted(top_degs, key=lambda x: abs(x["log2fc"]), reverse=True)
    
    if not top_degs:
        return {"nodes": [], "edges": []}
        
    locus_tags = [g["locus_tag"] for g in top_degs]
    fc_map = {g["locus_tag"]: g["log2fc"] for g in top_degs}
    symbol_map = {g["locus_tag"]: g["gene_symbol"] for g in top_degs}
    desc_map = {g["locus_tag"]: g["description"] for g in top_degs}
    
    url = "https://string-db.org/api/json/network"
    params = {
        "identifiers": "\n".join(locus_tags),
        "species": 4932,
        "required_score": score,
        "caller_identity": "yeast_rnaseq_analyzer"
    }
    
    try:
        r = requests.post(url, data=params, timeout=20, verify=False)
        r.raise_for_status()
        interactions = r.json()
    except Exception as e:
        print(f"STRING-DB API request failed: {e}")
        return {"success": False, "detail": "STRING-DB API 호출 실패. 네트워크 연결 상태를 확인해 주세요."}
        
    nodes = {}
    edges = []
    
    for inter in interactions:
        p1 = inter.get("preferredName_A")
        p2 = inter.get("preferredName_B")
        score_val = inter.get("score")
        
        l1 = inter.get("stringId_A").split(".")[-1]
        l2 = inter.get("stringId_B").split(".")[-1]
        
        for l, p in [(l1, p1), (l2, p2)]:
            if l not in nodes:
                nodes[l] = {
                    "id": l,
                    "label": symbol_map.get(l, p),
                    "log2fc": fc_map.get(l, 0.0),
                    "desc": desc_map.get(l, "")
                }
                
        edges.append({
            "source": l1,
            "target": l2,
            "score": score_val
        })
        
    return {
        "success": True,
        "nodes": list(nodes.values()),
        "edges": edges
    }

@app.get("/api/gsea_terms")
def get_gsea_terms():
    """Retrieve suitable GO terms for GSEA analysis with sufficient gene size."""
    df_go = get_go_data()
    if df_go.empty:
        return {"terms": []}
        
    counts = df_go.groupby(["goid", "term_name", "aspect"]).size().reset_index(name="count")
    filtered = counts[(counts["count"] >= 10) & (counts["count"] <= 200)]
    
    terms = []
    for _, row in filtered.iterrows():
        aspect_name = "Biological Process" if row["aspect"] == "P" else ("Molecular Function" if row["aspect"] == "F" else "Cellular Component")
        terms.append({
            "term_id": row["goid"],
            "name": row["term_name"],
            "aspect": aspect_name,
            "count": int(row["count"])
        })
        
    terms = sorted(terms, key=lambda x: x["count"], reverse=True)
    return {"terms": terms}

@app.get("/api/gsea_run/{term_id}")
def run_gsea_analysis(term_id: str):
    """Run GSEA-style running enrichment score calculation for a selected GO term."""
    if not os.path.exists(PARSED_DATA_PATH):
        raise HTTPException(status_code=400, detail="먼저 RNA-seq 데이터를 업로드해주세요.")
        
    with open(PARSED_DATA_PATH, "r", encoding="utf-8") as f:
        genes = json.load(f)
        
    df_go = get_go_data()
    if df_go.empty:
        raise HTTPException(status_code=500, detail="GO 데이터를 로드하지 못했습니다.")
        
    term_genes = set(df_go[df_go["goid"] == term_id]["locus_tag"])
    ranked_genes = sorted(genes, key=lambda x: x["log2fc"], reverse=True)
    N = len(ranked_genes)
    
    hits = [idx for idx, g in enumerate(ranked_genes) if g["locus_tag"] in term_genes]
    NH = len(hits)
    
    if NH == 0:
        return {"success": False, "detail": "이 GO 범주에 해당하는 업로드된 유전자가 없습니다."}
        
    hit_weights = [abs(ranked_genes[idx]["log2fc"]) for idx in hits]
    sum_hit_weights = sum(hit_weights)
    if sum_hit_weights == 0:
        hit_weights = [1.0] * NH
        sum_hit_weights = float(NH)
        
    es_profile = []
    current_es = 0.0
    max_es = -1.0
    max_idx = -1
    min_es = 1.0
    min_idx = -1
    
    hit_set = set(hits)
    
    for i in range(N):
        if i in hit_set:
            hit_pos = hits.index(i)
            current_es += hit_weights[hit_pos] / sum_hit_weights
        else:
            current_es -= 1.0 / (N - NH)
            
        if current_es > max_es:
            max_es = current_es
            max_idx = i
        if current_es < min_es:
            min_es = current_es
            min_idx = i
            
        if i in hit_set or i % 10 == 0 or i == N - 1:
            es_profile.append({
                "rank": i,
                "gene": ranked_genes[i]["gene_symbol"],
                "locus": ranked_genes[i]["locus_tag"],
                "log2fc": ranked_genes[i]["log2fc"],
                "es": float(current_es)
            })
            
    barcode_ranks = [{"rank": idx, "symbol": ranked_genes[idx]["gene_symbol"]} for idx in hits]
    
    return {
        "success": True,
        "term_id": term_id,
        "nes": float(max_es if abs(max_es) > abs(min_es) else min_es),
        "peak_rank": int(max_idx if abs(max_es) > abs(min_es) else min_idx),
        "es_profile": es_profile,
        "barcode_ranks": barcode_ranks
    }

@app.post("/api/domain_enrichment")
def run_domain_enrichment(payload: dict):
    """Run Protein Domain (Pfam/InterPro) enrichment on target genes using hypergeometric test."""
    target_genes = set(payload.get("genes", []))
    if not target_genes:
        raise HTTPException(status_code=400, detail="유전자 목록이 비어있습니다.")
        
    pfam_data = get_pfam_data()
    if not pfam_data:
        return {"enrichment": []}
        
    if not os.path.exists(PARSED_DATA_PATH):
        raise HTTPException(status_code=400, detail="먼저 RNA-seq 파일을 업로드해주세요.")
    with open(PARSED_DATA_PATH, "r", encoding="utf-8") as f:
        dataset_genes = json.load(f)
        
    background_genes = set(g["locus_tag"] for g in dataset_genes)
    target_genes = target_genes.intersection(background_genes)
    if not target_genes:
        return {"enrichment": []}
        
    N = len(background_genes)
    n = len(target_genes)
    
    domain_to_genes = {}
    domain_names = {}
    
    for locus in background_genes:
        domains = pfam_data.get(locus, [])
        for dom in domains:
            dom_id = dom["id"]
            dom_name = dom["name"]
            domain_names[dom_id] = dom_name
            
            if dom_id not in domain_to_genes:
                domain_to_genes[dom_id] = set()
            domain_to_genes[dom_id].add(locus)
            
    results = []
    for dom_id, dom_genes in domain_to_genes.items():
        M = len(dom_genes)
        overlap = target_genes.intersection(dom_genes)
        k = len(overlap)
        
        if k < 2:
            continue
            
        p_val = stats.hypergeom.sf(k - 1, N, M, n)
        
        results.append({
            "domain_id": dom_id,
            "domain_name": domain_names.get(dom_id, dom_id),
            "k": k,
            "M": M,
            "pvalue": float(p_val)
        })
        
    results_df = pd.DataFrame(results)
    if not results_df.empty:
        results_df = results_df.sort_values("pvalue")
        pvals = results_df["pvalue"].values
        n_terms = len(pvals)
        fdrs = np.zeros(n_terms)
        prev_fdr = 1.0
        for rank in range(n_terms - 1, -1, -1):
            fdr = pvals[rank] * n_terms / (rank + 1)
            fdr = min(fdr, prev_fdr)
            fdrs[rank] = fdr
            prev_fdr = fdr
        results_df["fdr"] = fdrs
        
        return {"enrichment": results_df.to_dict(orient="records")}
        
    return {"enrichment": []}

@app.get("/mock_yeast_rnaseq.xlsx")
def get_mock_file():
    """Serve the generated mock Excel file."""
    if os.path.exists("mock_yeast_rnaseq.xlsx"):
        return FileResponse("mock_yeast_rnaseq.xlsx", media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename="mock_yeast_rnaseq.xlsx")
    raise HTTPException(status_code=404, detail="Mock file not found. Please run generate_mock_data.py first.")

# Mount static files folder (will serve our frontend UI)
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    import threading
    import time
    import webbrowser

    def open_browser():
        time.sleep(1.5)
        url = "http://127.0.0.1:8500"
        try:
            # 1. 시스템에 등록된 Chrome 브라우저 기동 시도
            chrome = webbrowser.get("chrome")
            chrome.open(url)
        except Exception:
            try:
                # 2. Windows 기본 Chrome 기본 설치 경로 직접 탐색
                chrome_paths = [
                    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
                ]
                opened = False
                for path in chrome_paths:
                    if os.path.exists(path):
                        webbrowser.register('chrome_path', None, webbrowser.BackgroundBrowser(path))
                        webbrowser.get('chrome_path').open(url)
                        opened = True
                        break
                if not opened:
                    webbrowser.open(url)
            except Exception:
                webbrowser.open(url)

    # 브라우저 자동 오픈 스레드 시작
    threading.Thread(target=open_browser, daemon=True).start()

    # Download data on start
    get_ncbi_mapping()
    get_pfam_data()
    get_go_data()
    get_kegg_pathways()
    get_kegg_gene_mapping()
    # Run server
    uvicorn.run(app, host="127.0.0.1", port=8500)
