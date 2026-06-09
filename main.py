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

    # 5. Classify numeric columns for expression values
    numeric_cols = []
    for col in df.columns:
        if col != locus_col and col != symbol_col and col != desc_col and col != biotype_col:
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

@app.get("/api/pathways")
def get_pathways():
    """Get list of yeast KEGG pathways."""
    pathways = get_kegg_pathways()
    # Also count how many genes are in our uploaded data for each pathway
    gene_to_pathways = get_kegg_gene_mapping()
    
    genes_in_data = set()
    if os.path.exists(PARSED_DATA_PATH):
        with open(PARSED_DATA_PATH, "r", encoding="utf-8") as f:
            genes_in_data = set(g["locus_tag"] for g in json.load(f))
            
    pathway_counts = {}
    for path_id, genes in gene_to_pathways.items():
        overlap = genes_in_data.intersection(genes)
        pathway_counts[path_id] = len(overlap)
        
    pathways_list = []
    for path_id, desc in pathways.items():
        pathways_list.append({
            "pathway_id": path_id,
            "description": desc,
            "gene_count": pathway_counts.get(path_id, 0)
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
    degs = sorted(degs, key=lambda x: abs(x["log2fc"]), reverse=True)
    top_degs = degs[:limit]
    
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
