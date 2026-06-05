import os
import re
import json
import shutil
import urllib.parse
import requests
import pandas as pd
import numpy as np
from scipy import stats
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

app = FastAPI(title="Yeast RNA-seq Analyzer API")

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

# ----------------------------------------------------------------------
# 1. Helpers for caching GO and KEGG data
# ----------------------------------------------------------------------

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

@app.post("/api/upload")
def upload_file(file: UploadFile = File(...)):
    """Upload Excel/CSV and calculate DEG statistics."""
    temp_path = os.path.join(CACHE_DIR, file.filename)
    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        # Parse based on extension
        if file.filename.endswith((".xlsx", ".xls")):
            df = pd.read_excel(temp_path)
        else:
            df = pd.read_csv(temp_path)
            
        os.remove(temp_path) # Clean up file
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse file: {str(e)}")

    # Clean columns
    df.columns = [c.strip() for c in df.columns]
    
    # Find locus_tag column
    locus_col = None
    for col in df.columns:
        if col.lower() in ["locus_tag", "locus", "systematic_name", "orf", "orf_name"]:
            locus_col = col
            break
    if not locus_col:
        # Check contents of columns to find locus tag pattern (e.g. YAL038W)
        for col in df.columns:
            non_nulls = df[col].dropna()
            if not non_nulls.empty and non_nulls.astype(str).str.match(r"^Y[A-P][0-9]{3}[C,W](-[A-G])?$", case=False).mean() > 0.5:
                locus_col = col
                break
    if not locus_col:
        raise HTTPException(status_code=400, detail="유전자 Systematic Name (locus_tag, 예: YAL038W) 열을 찾을 수 없습니다. 열 이름을 'locus_tag'로 지정해주세요.")

    # Find gene symbol column
    symbol_col = None
    for col in df.columns:
        if col.lower() in ["gene_symbol", "symbol", "gene", "gene_name"]:
            symbol_col = col
            break
    if not symbol_col:
        symbol_col = locus_col # Fallback to locus_tag

    # Detect replicates vs average columns
    mut_rep_cols = []
    wt_rep_cols = []
    
    # Replicates detection (e.g. Mutant_TPM_1, WT_TPM_1)
    for col in df.columns:
        if "mutant" in col.lower() and any(x in col.lower() for x in ["tpm", "fpkm", "count", "read"]) and re.search(r"\d+$", col):
            mut_rep_cols.append(col)
        elif "wt" in col.lower() and any(x in col.lower() for x in ["tpm", "fpkm", "count", "read"]) and re.search(r"\d+$", col):
            wt_rep_cols.append(col)
            
    is_replicate_mode = len(mut_rep_cols) >= 2 and len(wt_rep_cols) >= 2
    
    genes_list = []
    
    if is_replicate_mode:
        print(f"Replicate mode detected: Mutant={mut_rep_cols}, WT={wt_rep_cols}")
        for _, row in df.iterrows():
            locus = str(row[locus_col]).strip()
            symbol = str(row[symbol_col]).strip() if pd.notna(row[symbol_col]) else locus
            desc = str(row["Description"]) if "Description" in df.columns and pd.notna(row["Description"]) else ""
            biotype = str(row["gene_biotype"]) if "gene_biotype" in df.columns and pd.notna(row["gene_biotype"]) else "protein_coding"
            
            mut_vals = [float(row[c]) for c in mut_rep_cols if pd.notna(row[c])]
            wt_vals = [float(row[c]) for c in wt_rep_cols if pd.notna(row[c])]
            
            if len(mut_vals) < 2 or len(wt_vals) < 2:
                continue
                
            mut_mean = np.mean(mut_vals)
            wt_mean = np.mean(wt_vals)
            
            # Welch's t-test
            t_stat, p_val = stats.ttest_ind(mut_vals, wt_vals, equal_var=False)
            if np.isnan(p_val):
                p_val = 1.0
                
            # Log2 Fold Change
            # Use small pseudocount to prevent div by zero
            log2fc = np.log2((mut_mean + 0.01) / (wt_mean + 0.01))
            
            genes_list.append({
                "locus_tag": locus,
                "gene_symbol": symbol,
                "description": desc,
                "biotype": biotype,
                "wt_val": round(wt_mean, 2),
                "mutant_val": round(mut_mean, 2),
                "log2fc": round(float(log2fc), 4),
                "pvalue": round(float(p_val), 6),
                "mut_reps": [round(v, 2) for v in mut_vals],
                "wt_reps": [round(v, 2) for v in wt_vals]
            })
            
        # Calculate FDR (Benjamini-Hochberg)
        genes_df = pd.DataFrame(genes_list)
        if not genes_df.empty:
            pvals = genes_df["pvalue"].values
            n = len(pvals)
            sorted_indices = np.argsort(pvals)
            sorted_pvals = pvals[sorted_indices]
            
            fdrs = np.zeros(n)
            prev_fdr = 1.0
            for rank in range(n - 1, -1, -1):
                fdr = sorted_pvals[rank] * n / (rank + 1)
                fdr = min(fdr, prev_fdr)
                fdrs[rank] = fdr
                prev_fdr = fdr
                
            unsorted_fdrs = np.zeros(n)
            unsorted_fdrs[sorted_indices] = fdrs
            
            for idx, item in enumerate(genes_list):
                item["fdr"] = round(float(unsorted_fdrs[idx]), 6)
                
    else:
        # Average mode (or simple comparison)
        print("Average mode (No replicates) detected.")
        # Find Mutant and WT AVG expression columns
        mut_avg_col = None
        wt_avg_col = None
        
        # Look for explicit AVG column
        for col in df.columns:
            if "mutant" in col.lower() and ("avg" in col.lower() or "count" in col.lower() or "tpm" in col.lower() or "fpkm" in col.lower()):
                mut_avg_col = col
            if "wt" in col.lower() and ("avg" in col.lower() or "count" in col.lower() or "tpm" in col.lower() or "fpkm" in col.lower()):
                wt_avg_col = col
                
        # Prefer TPM/FPKM if multiple matches
        for col in df.columns:
            if "mutant" in col.lower() and "tpm" in col.lower():
                mut_avg_col = col
            if "wt" in col.lower() and "tpm" in col.lower():
                wt_avg_col = col
                
        if not mut_avg_col or not wt_avg_col:
            # Fallback to any Mutant and WT columns
            for col in df.columns:
                if "mutant" in col.lower():
                    mut_avg_col = col
                if "wt" in col.lower():
                    wt_avg_col = col
                    
        if not mut_avg_col or not wt_avg_col:
            raise HTTPException(status_code=400, detail="Mutant 및 WT 발현량 데이터를 나타내는 열을 감지할 수 없습니다.")
            
        print(f"Using average columns: Mutant={mut_avg_col}, WT={wt_avg_col}")
        
        for _, row in df.iterrows():
            locus = str(row[locus_col]).strip()
            symbol = str(row[symbol_col]).strip() if pd.notna(row[symbol_col]) else locus
            desc = str(row["Description"]) if "Description" in df.columns and pd.notna(row["Description"]) else ""
            biotype = str(row["gene_biotype"]) if "gene_biotype" in df.columns and pd.notna(row["gene_biotype"]) else "protein_coding"
            
            mut_val = float(row[mut_avg_col]) if pd.notna(row[mut_avg_col]) else 0.0
            wt_val = float(row[wt_avg_col]) if pd.notna(row[wt_avg_col]) else 0.0
            
            # Log2 Fold Change
            log2fc = np.log2((mut_val + 0.01) / (wt_val + 0.01))
            
            genes_list.append({
                "locus_tag": locus,
                "gene_symbol": symbol,
                "description": desc,
                "biotype": biotype,
                "wt_val": round(wt_val, 2),
                "mutant_val": round(mut_val, 2),
                "log2fc": round(float(log2fc), 4),
                "pvalue": None,
                "fdr": None
            })
            
    # Save the parsed data to data_cache
    with open(PARSED_DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(genes_list, f, indent=2, ensure_ascii=False)
        
    return {
        "success": True,
        "is_replicate_mode": is_replicate_mode,
        "genes_count": len(genes_list),
        "genes": genes_list[:100] # Return first 100 for quick view
    }

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
    # Download data on start
    get_go_data()
    get_kegg_pathways()
    get_kegg_gene_mapping()
    # Run server
    uvicorn.run(app, host="127.0.0.1", port=8000)
