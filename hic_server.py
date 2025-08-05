from flask import Flask, jsonify, request
from flask_cors import CORS
import cooler
import cooltools
from cooltools.api.insulation import find_boundaries as call_boundaries
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import eigs
import pandas as pd
import numpy as np
import traceback
import bioframe as bf 
import warnings

# Suppress FutureWarning messages
warnings.filterwarnings("ignore", category=FutureWarning)

# --- CONFIGURATION ---
MCOOL_FILE_PATH = './GM12878_10kb.mcool'
PORT = 5000

# --- FLASK APP SETUP ---
app = Flask(__name__)
CORS(app) 

RESOLUTIONS = [10000, 20000, 40000, 80000, 160000, 320000, 640000, 1280000, 2560000, 5120000]
print(f"Using resolutions: {RESOLUTIONS}")

# --- API Endpoints ---

@app.route('/api/v1/tiles/<int:zoom>/<int:x>/<int:y>')
def get_tile(zoom, x, y):
    try:
        if zoom >= len(RESOLUTIONS):
            return jsonify({"error": "Zoom level out of bounds"}), 404
        resolution = RESOLUTIONS[zoom]
        c = cooler.Cooler(f'{MCOOL_FILE_PATH}::/resolutions/{resolution}')
        chrom_name = 'chr2'
        chrom_len = c.chromsizes[chrom_name]
        start_bp = x * 256 * resolution
        end_bp = (x + 1) * 256 * resolution
        if start_bp >= chrom_len:
            return jsonify({ 'data': [] })
        if end_bp > chrom_len:
            end_bp = chrom_len
        region = f'{chrom_name}:{start_bp}-{end_bp}'
        matrix_data = c.matrix(balance=False).fetch(region)
        matrix_data = matrix_data.astype(float)
        matrix_data[np.isnan(matrix_data)] = None
        return jsonify({ 'data': matrix_data.tolist() })
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/api/v1/boundaries')
def get_boundaries():
    try:
        region_str = request.args.get('region')
        chrom, coords = region_str.split(':')
        start_str, end_str = coords.split('-')
        view_df = pd.DataFrame([{'chrom': chrom, 'start': int(start_str), 'end': int(end_str)}])
        view_df = bf.make_viewframe(view_df)
        resolution = 10000
        c = cooler.Cooler(f'{MCOOL_FILE_PATH}::/resolutions/{resolution}')
        
        # DEFINITIVE FIX: Use ignore_diags AND clr_weight_name=None
        ins_score = cooltools.insulation(
            c, 
            [10 * resolution], 
            view_df, 
            verbose=False, 
            ignore_diags=2,
            clr_weight_name=None
        )
        
        boundaries = call_boundaries(ins_score)
        boundaries = boundaries.replace({np.nan: None})
        result = boundaries.to_dict(orient='records')
        return jsonify(result)
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

# --- REWRITTEN Spectral Analysis Endpoint ---
@app.route('/api/v1/compartments')
def get_compartments():
    """
    Performs spectral analysis manually to avoid cooltools versioning issues.
    """
    try:
        region_str = request.args.get('region')
        print(f"Calculating A/B compartments for {region_str}...")
        
        resolution = 10000
        c = cooler.Cooler(f'{MCOOL_FILE_PATH}::/resolutions/{resolution}')
        
        matrix = c.matrix(balance=False).fetch(region_str)
        
        sp_matrix = coo_matrix(matrix)
        eigenvalues, eigenvectors = eigs(sp_matrix, k=1, which='LR')
        
        bins = c.bins().fetch(region_str)
        bins['E1'] = np.real(eigenvectors[:, 0])
        
        compartment_track = bins[['chrom', 'start', 'end', 'E1']]
        compartment_track = compartment_track.replace({np.nan: None})
        
        result = compartment_track.to_dict(orient='records')
        return jsonify(result)

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    print(f"Starting Hi-C data server on http://localhost:{PORT}")
    app.run(port=PORT, debug=True)
