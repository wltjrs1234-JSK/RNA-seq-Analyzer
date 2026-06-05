import pandas as pd
import numpy as np

# Yeast genes list with description and systematic locus_tag
# We include some Glycolysis genes, Ribosomal genes, and others
yeast_genes_data = [
    # Glycolysis pathway (sce00010) genes
    {"Gene_ID": 855762, "Transcript_ID": "NM_001178652", "Gene_Symbol": "CDC19", "Description": "Pyruvate kinase", "locus_tag": "YAL038W", "pathway": "glycolysis", "direction": "down"},
    {"Gene_ID": 850733, "Transcript_ID": "NM_001181931", "Gene_Symbol": "PDC1", "Description": "Indolepyruvate decarboxylase / pyruvate decarboxylase", "locus_tag": "YLR044C", "pathway": "glycolysis", "direction": "down"},
    {"Gene_ID": 853805, "Transcript_ID": "NM_001179526", "Gene_Symbol": "FBA1", "Description": "Fructose-bisphosphate aldolase", "locus_tag": "YKL060C", "pathway": "glycolysis", "direction": "down"},
    {"Gene_ID": 856579, "Transcript_ID": "NM_001179305", "Gene_Symbol": "ENO2", "Description": "Phosphopyruvate hydratase / Enolase 2", "locus_tag": "YHR174W", "pathway": "glycolysis", "direction": "down"},
    {"Gene_ID": 853705, "Transcript_ID": "NM_001179718", "Gene_Symbol": "GPM1", "Description": "Phosphoglycerate mutase 1", "locus_tag": "YKL152C", "pathway": "glycolysis", "direction": "down"},
    {"Gene_ID": 853106, "Transcript_ID": "NM_001181321", "Gene_Symbol": "TDH3", "Description": "Glyceraldehyde-3-phosphate dehydrogenase", "locus_tag": "YGR192C", "pathway": "glycolysis", "direction": "down"},
    {"Gene_ID": 854068, "Transcript_ID": "NM_001183340", "Gene_Symbol": "ADH1", "Description": "Alcohol dehydrogenase ADH1", "locus_tag": "YOL086C", "pathway": "glycolysis", "direction": "down"},
    {"Gene_ID": 854817, "Transcript_ID": "NM_001182285", "Gene_Symbol": "PGI1", "Description": "Phosphoglucose isomerase", "locus_tag": "YBR196C", "pathway": "glycolysis", "direction": "unchanged"},
    {"Gene_ID": 853503, "Transcript_ID": "NM_001181056", "Gene_Symbol": "HXK1", "Description": "Hexokinase 1", "locus_tag": "YFR053C", "pathway": "glycolysis", "direction": "up"},
    {"Gene_ID": 851253, "Transcript_ID": "NM_001182512", "Gene_Symbol": "HXK2", "Description": "Hexokinase 2", "locus_tag": "YGL253W", "pathway": "glycolysis", "direction": "up"},
    {"Gene_ID": 856238, "Transcript_ID": "NM_001178713", "Gene_Symbol": "PFK1", "Description": "Phosphofructokinase 1 alpha subunit", "locus_tag": "YGR240C", "pathway": "glycolysis", "direction": "up"},
    {"Gene_ID": 855210, "Transcript_ID": "NM_001178550", "Gene_Symbol": "PFK2", "Description": "Phosphofructokinase 1 beta subunit", "locus_tag": "YMR205C", "pathway": "glycolysis", "direction": "up"},

    # Translation Elongation / Ribosomal genes (often highly expressed)
    {"Gene_ID": 852415, "Transcript_ID": "NM_001179466", "Gene_Symbol": "TEF2", "Description": "Translation elongation factor EF-1 alpha", "locus_tag": "YBR110W", "pathway": "translation", "direction": "unchanged"},
    {"Gene_ID": 856195, "Transcript_ID": "NM_001184177", "Gene_Symbol": "TEF1", "Description": "Translation elongation factor EF-1 alpha", "locus_tag": "YPR080W", "pathway": "translation", "direction": "unchanged"},
    {"Gene_ID": 850864, "Transcript_ID": "NM_001182054", "Gene_Symbol": "RPS31", "Description": "Ribosomal 40S subunit protein S31", "locus_tag": "YLR167W", "pathway": "translation", "direction": "unchanged"},
    {"Gene_ID": 853250, "Transcript_ID": "NM_001181622", "Gene_Symbol": "RPL39", "Description": "Ribosomal 60S subunit protein L39", "locus_tag": "YJL189W", "pathway": "translation", "direction": "up"},
    {"Gene_ID": 856371, "Transcript_ID": "NM_001179095", "Gene_Symbol": "RPS20", "Description": "Ribosomal 40S subunit protein S20", "locus_tag": "YFL015C", "pathway": "translation", "direction": "up"},
    {"Gene_ID": 852775, "Transcript_ID": "NM_001180968", "Gene_Symbol": "RPL28", "Description": "Ribosomal 60S subunit protein L28", "locus_tag": "YGL103W", "pathway": "translation", "direction": "down"},
    {"Gene_ID": 852911, "Transcript_ID": "NM_001181156", "Gene_Symbol": "RPS25A", "Description": "Ribosomal 40S subunit protein S25A", "locus_tag": "YGR027C", "pathway": "translation", "direction": "down"},
    {"Gene_ID": 854468, "Transcript_ID": "NM_001183712", "Gene_Symbol": "RPS10A", "Description": "Ribosomal 40S subunit protein S10A", "locus_tag": "YDR293W", "pathway": "translation", "direction": "down"},
    {"Gene_ID": 853993, "Transcript_ID": "NM_001183381", "Gene_Symbol": "RPL25", "Description": "Ribosomal 60S subunit protein L25", "locus_tag": "YOL127W", "pathway": "translation", "direction": "unchanged"},
    {"Gene_ID": 850994, "Transcript_ID": "NM_001182175", "Gene_Symbol": "RPS30A", "Description": "Ribosomal 40S subunit protein S30A", "locus_tag": "YLR287C-A", "pathway": "translation", "direction": "unchanged"},
    {"Gene_ID": 850764, "Transcript_ID": "NM_001181962", "Gene_Symbol": "RPL10", "Description": "Ribosomal 60S subunit protein L10", "locus_tag": "YOR075W", "pathway": "translation", "direction": "unchanged"},
    {"Gene_ID": 852686, "Transcript_ID": "NM_001181054", "Gene_Symbol": "RPS26A", "Description": "Ribosomal 40S subunit protein S26A", "locus_tag": "YGL189C", "pathway": "translation", "direction": "unchanged"},
    {"Gene_ID": 854551, "Transcript_ID": "NM_001183789", "Gene_Symbol": "RPS12", "Description": "Ribosomal 40S subunit protein S12", "locus_tag": "YOR369C", "pathway": "translation", "direction": "unchanged"},
    {"Gene_ID": 850716, "Transcript_ID": "NM_001181916", "Gene_Symbol": "RPL15A", "Description": "Ribosomal 60S subunit protein L15A", "locus_tag": "YLR029C", "pathway": "translation", "direction": "unchanged"},
    {"Gene_ID": 854229, "Transcript_ID": "NM_001183482", "Gene_Symbol": "RPL3", "Description": "Ribosomal 60S subunit protein L3", "locus_tag": "YOR063W", "pathway": "translation", "direction": "unchanged"},
    {"Gene_ID": 854658, "Transcript_ID": "NM_001179496", "Gene_Symbol": "RPL40A", "Description": "Ribosomal 60S subunit protein L40A", "locus_tag": "YIL148W", "pathway": "translation", "direction": "unchanged"},
    {"Gene_ID": 852185, "Transcript_ID": "NM_001178332", "Gene_Symbol": "RPL32", "Description": "Ribosomal 60S subunit protein L32", "locus_tag": "YPL090C", "pathway": "translation", "direction": "unchanged"},
    {"Gene_ID": 851035, "Transcript_ID": "NM_001182214", "Gene_Symbol": "RPL38", "Description": "Ribosomal 60S subunit protein L38", "locus_tag": "YLR325C", "pathway": "translation", "direction": "unchanged"},
    {"Gene_ID": 854939, "Transcript_ID": "NM_001182422", "Gene_Symbol": "RPS1B", "Description": "Ribosomal 40S subunit protein S1B", "locus_tag": "YML063W", "pathway": "translation", "direction": "unchanged"},

    # TCA Cycle (sce00020) and other metabolic pathways
    {"Gene_ID": 850383, "Transcript_ID": "NM_001181515", "Gene_Symbol": "CIT1", "Description": "Citrate synthase", "locus_tag": "YPR026W", "pathway": "tca", "direction": "up"},
    {"Gene_ID": 851829, "Transcript_ID": "NM_001180295", "Gene_Symbol": "ACO1", "Description": "Aconitase", "locus_tag": "YLR304C", "pathway": "tca", "direction": "up"},
    {"Gene_ID": 851638, "Transcript_ID": "NM_001182811", "Gene_Symbol": "IDH1", "Description": "Isocitrate dehydrogenase subunit 1", "locus_tag": "YNL037C", "pathway": "tca", "direction": "up"},
    {"Gene_ID": 854964, "Transcript_ID": "NM_001182442", "Gene_Symbol": "IDH2", "Description": "Isocitrate dehydrogenase subunit 2", "locus_tag": "YOR136W", "pathway": "tca", "direction": "up"},
    {"Gene_ID": 855848, "Transcript_ID": "NM_001178822", "Gene_Symbol": "KGD1", "Description": "Alpha-ketoglutarate dehydrogenase", "locus_tag": "YIL125W", "pathway": "tca", "direction": "down"},
    {"Gene_ID": 855073, "Transcript_ID": "NM_001182531", "Gene_Symbol": "KGD2", "Description": "Dihydrolipoyltranssuccinylase", "locus_tag": "YDR148C", "pathway": "tca", "direction": "down"},
    {"Gene_ID": 850406, "Transcript_ID": "NM_001181525", "Gene_Symbol": "LSC1", "Description": "Succinyl-CoA ligase alpha subunit", "locus_tag": "YOR142W", "pathway": "tca", "direction": "unchanged"},
    {"Gene_ID": 853034, "Transcript_ID": "NM_001181262", "Gene_Symbol": "LSC2", "Description": "Succinyl-CoA ligase beta subunit", "locus_tag": "YGR244C", "pathway": "tca", "direction": "unchanged"},
    {"Gene_ID": 855163, "Transcript_ID": "NM_001178513", "Gene_Symbol": "SDH1", "Description": "Succinate dehydrogenase flavoprotein subunit", "locus_tag": "YKL148C", "pathway": "tca", "direction": "down"},
    {"Gene_ID": 855325, "Transcript_ID": "NM_001178613", "Gene_Symbol": "SDH2", "Description": "Succinate dehydrogenase iron-sulfur subunit", "locus_tag": "YLL041C", "pathway": "tca", "direction": "down"},
    {"Gene_ID": 850367, "Transcript_ID": "NM_001181505", "Gene_Symbol": "FUM1", "Description": "Fumarase", "locus_tag": "YPL262W", "pathway": "tca", "direction": "up"},
    {"Gene_ID": 850933, "Transcript_ID": "NM_001182125", "Gene_Symbol": "MDH1", "Description": "Mitochondrial malate dehydrogenase", "locus_tag": "YKL085W", "pathway": "tca", "direction": "up"},
]

# Let's expand this list to have around 80 genes total by adding some other yeast genes
extra_genes = [
    ("YAL001C", "TFC3", "Transcription factor tau subunit", "protein_coding", "NP_009310.1"),
    ("YAL002W", "VPS8", "Membrane-associated protein", "protein_coding", "NP_009311.1"),
    ("YAL003W", "EFB1", "Translation elongation factor EF-1 beta", "protein_coding", "NP_009312.1"),
    ("YAL005C", "SSA1", "HSP70 family ATPase", "protein_coding", "NP_009314.1"),
    ("YAL007C", "ERP2", "Protein of the p24 family", "protein_coding", "NP_009316.1"),
    ("YAL008W", "FUN14", "Mitochondrial inner membrane protein", "protein_coding", "NP_009317.1"),
    ("YAL009W", "SPO7", "Regulatory subunit of Nem1p-Spo7p phosphatase", "protein_coding", "NP_009318.1"),
    ("YAL010C", "MDN1", "Giant dynein-related AAA+ ATPase", "protein_coding", "NP_009319.1"),
    ("YAL012W", "CYS3", "Cystathionine gamma-lyase", "protein_coding", "NP_009321.1"),
    ("YAL016W", "TPD3", "Regulatory subunit A of protein phosphatase 2A", "protein_coding", "NP_009325.1"),
    ("YAL021C", "CCR4", "Component of the CCR4-NOT core complex", "protein_coding", "NP_009330.1"),
    ("YAL024C", "LTE1", "Essential GDP-GTP exchange factor", "protein_coding", "NP_009333.1"),
    ("YBR072W", "HSP26", "Small heat shock protein", "protein_coding", "NP_009638.1"),
    ("YDL229W", "SSB1", "Hsp70 family chaperone", "protein_coding", "NP_010515.1"),
    ("YDR258C", "HSP78", "Oligomeric mitochondrial chaperone", "protein_coding", "NP_010210.1"),
    ("YFL039C", "ACT1", "Actin structural protein", "protein_coding", "NP_011100.1"),
    ("YDL020C", "RPB2", "RNA polymerase II second largest subunit", "protein_coding", "NP_010300.1"),
]

for i, (locus, symbol, desc, biotype, prot_id) in enumerate(extra_genes):
    dir_choice = np.random.choice(["up", "down", "unchanged"], p=[0.2, 0.2, 0.6])
    yeast_genes_data.append({
        "Gene_ID": 850000 + i,
        "Transcript_ID": f"NM_001180{i:03d}",
        "Gene_Symbol": symbol,
        "Description": desc,
        "locus_tag": locus,
        "pathway": "other",
        "direction": dir_choice
    })

# Now simulate WT expression values
np.random.seed(42)
rows = []

for item in yeast_genes_data:
    # Baseline WT expression (TPM)
    # Ribosomal and some elongation factors are very highly expressed (1000 - 50000 TPM)
    # Glycolysis genes are highly expressed (500 - 10000 TPM)
    # Others are medium-low (5 - 500 TPM)
    if item["pathway"] == "translation":
        wt_tpm = np.random.exponential(15000) + 1000
    elif item["pathway"] == "glycolysis":
        wt_tpm = np.random.exponential(5000) + 500
    else:
        wt_tpm = np.random.exponential(200) + 10
        
    # Read count is correlated with TPM (let's say count = TPM * multiplier)
    wt_multiplier = np.random.uniform(5, 10)
    wt_count = wt_tpm * wt_multiplier
    
    # FPKM is also correlated (usually FPKM ~ TPM / 2 in simple mock terms)
    wt_fpkm = wt_tpm * np.random.uniform(0.4, 0.6)
    
    # Calculate Mutant expression based on direction
    if item["direction"] == "up":
        fold_change = np.random.uniform(2.0, 8.0)
    elif item["direction"] == "down":
        fold_change = 1 / np.random.uniform(2.0, 8.0)
    else:
        fold_change = np.random.uniform(0.8, 1.2)
        
    mutant_tpm = wt_tpm * fold_change
    mutant_count = wt_count * fold_change * np.random.uniform(0.9, 1.1)
    mutant_fpkm = wt_fpkm * fold_change
    
    # Add some replicates for p-value calculation in backend testing
    # WT replicates
    wt_tpm_rep1 = wt_tpm * np.random.uniform(0.9, 1.1)
    wt_tpm_rep2 = wt_tpm * np.random.uniform(0.9, 1.1)
    wt_tpm_rep3 = wt_tpm * np.random.uniform(0.9, 1.1)
    # Mutant replicates
    mut_tpm_rep1 = mutant_tpm * np.random.uniform(0.9, 1.1)
    mut_tpm_rep2 = mutant_tpm * np.random.uniform(0.9, 1.1)
    mut_tpm_rep3 = mutant_tpm * np.random.uniform(0.9, 1.1)
    
    rows.append({
        "Gene_ID": item["Gene_ID"],
        "Transcript_ID": item["Transcript_ID"],
        "Gene_Symbol": item["Gene_Symbol"],
        "Description": item["Description"],
        "Mutant_Read count AVG": round(mutant_count, 1),
        "WT_Read count AVG": round(wt_count, 1),
        "Mutant_FPKM AVG": round(mutant_fpkm, 2),
        "WT_FPKM AVG": round(wt_fpkm, 2),
        "Mutant_TPM AVG": round(mutant_tpm, 2),
        "WT_TPM AVG": round(wt_tpm, 2),
        # Add replicates columns so that our tool can showcase BOTH replicate and average mode!
        "Mutant_TPM_1": round(mut_tpm_rep1, 2),
        "Mutant_TPM_2": round(mut_tpm_rep2, 2),
        "Mutant_TPM_3": round(mut_tpm_rep3, 2),
        "WT_TPM_1": round(wt_tpm_rep1, 2),
        "WT_TPM_2": round(wt_tpm_rep2, 2),
        "WT_TPM_3": round(wt_tpm_rep3, 2),
        "gene_biotype": "protein_coding",
        "Protein_ID": f"NP_{100000 + item['Gene_ID'] % 100000}.1",
        "locus_tag": item["locus_tag"],
        "GenBank": "."
    })

df = pd.DataFrame(rows)

# Save to Excel
output_path = "mock_yeast_rnaseq.xlsx"
df.to_excel(output_path, index=False)
print(f"Mock dataset generated successfully at '{output_path}'. Total rows: {len(df)}")
