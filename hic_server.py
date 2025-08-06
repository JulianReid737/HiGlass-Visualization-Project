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

# --- Path integration for ClusterTAD ---
import sys
import os

# Get the directory where THIS script (hic_server.py) is located
script_dir = os.path.dirname(os.path.realpath(__file__))
# The path to the 'src' folder is inside the 'ClusterTAD' sub-directory
cluster_tad_path = os.path.join(script_dir, 'ClusterTAD', 'src')

if cluster_tad_path not in sys.path:
    sys.path.append(cluster_tad_path)

try:
    # --- FIX: The function is named 'ClusterTAD', not 'TAD_caller' ---
    from ClusterTAD import ClusterTAD
    print("Successfully imported ClusterTAD module.")
except ImportError as e:
    print(f"FATAL: Could not import ClusterTAD. Error: {e}")
    sys.exit(1)


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

@app.route('/api/v1/tads', methods=['POST'])
def get_tads():
    try:
        data = request.get_json()
        region_str = data.get('region')
        method = data.get('method', 'insulation') # Default to 'insulation'
        resolution = 10000 # Use a fixed high resolution for TAD calling

        chrom, coords = region_str.split(':')
        start_str, end_str = coords.split('-')
        start_bp = int(start_str)

        c = cooler.Cooler(f'{MCOOL_FILE_PATH}::/resolutions/{resolution}')
        
        tads = []

        if method == 'clustertad':
            print(f"Finding TADs for {region_str} using ClusterTAD...")
            matrix = c.matrix(balance=False).fetch(region_str)
            matrix = np.nan_to_num(matrix)
            
            # --- FIX: Call the correct function name ---
            # The function requires a matrix and an output file path (which we don't need, so we set to None)
            boundary_indices = ClusterTAD(matrix, None)

            # Convert indices back to genomic coordinates and form TADs
            for i in range(len(boundary_indices) - 1):
                tad_start_bp = start_bp + boundary_indices[i] * resolution
                tad_end_bp = start_bp + boundary_indices[i+1] * resolution
                tads.append({"start": tad_start_bp, "end": tad_end_bp})

        elif method == 'insulation':
            print(f"Finding TADs for {region_str} using Insulation Score...")
            view_df = pd.DataFrame([{'chrom': chrom, 'start': int(start_str), 'end': int(end_str)}])
            view_df = bf.make_viewframe(view_df)
            
            ins_score = cooltools.insulation(
                c,
                [10 * resolution],
                view_df,
                verbose=False,
                ignore_diags=2,
                clr_weight_name=None
            )
            boundaries = call_boundaries(ins_score)
            
            # Convert boundaries to TADs (each boundary is the end of one TAD and start of next)
            boundary_pos = boundaries[boundaries['is_boundary_100000'] == True]['start'].tolist()
            tad_starts = [start_bp] + boundary_pos
            tad_ends = boundary_pos + [int(end_str)]

            for s, e in zip(tad_starts, tad_ends):
                if e > s:
                    tads.append({"start": s, "end": e})
        
        else:
            return jsonify({"error": f"Unknown TAD method: {method}"}), 400

        return jsonify(tads)

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/api/v1/compartments')
def get_compartments():
    try:
        region_str = request.args.get('region')
        print(f"Calculating A/B compartments for {region_str}...")

        resolution = 10000
        c = cooler.Cooler(f'{MCOOL_FILE_PATH}::/resolutions/{resolution}')

        matrix = c.matrix(balance=False).fetch(region_str)
        matrix = matrix.astype(float)

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
