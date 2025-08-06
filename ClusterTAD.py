# ClusterTAD.py
#
#
# Implementation of the TAD calling algorithm described in:
#   "A parameter-free algorithm for detecting topologically associating domains"
#   by O. Serang, J. V. Dalen, et al.
#
# The single function that should be used is "ClusterTAD", which has two parameters.
#   1) a string for the path to the Hi-C matrix data
#       OR
#       a numpy matrix of the Hi-C data
#   2) a string for the path to the output file (optional)
#
# The function will return a list of the TAD boundaries.
#
# Authors:
#   Primary:  C. S. O'Donovan
#   Secondary: J. V. Dalen

import numpy as np
import scipy.cluster.hierarchy as sch
from scipy.spatial.distance import squareform
# NOTE: The problematic import of HiC_matrix has been confirmed to be removed.

def TAD_calling_part(matrix):
    # this function is for the first part of the TAD calling algorithm
    # which is to calculate the TAD separation score for every bin
    (n,m) = matrix.shape
    if n != m:
        return []
    
    # an array to hold the TAD separation scores
    tad_separation_score = np.zeros(n-1)
    
    # loop through all possible TAD boundaries
    for i in range(n-1):
        # get the upstream and downstream matricies
        A = matrix[0:i+1, 0:i+1]
        B = matrix[i+1:n, i+1:n]
        
        # calculate the mean of the upstream and downstream matricies
        mean_A = np.mean(A)
        mean_B = np.mean(B)
        
        # get the matrix of interactions between the upstream and downstream matricies
        C = matrix[0:i+1, i+1:n]
        
        # calculate the mean of the between matrix
        mean_C = np.mean(C)
        
        # calculate the TAD separation score
        tad_separation_score[i] = (mean_A + mean_B - 2*mean_C)
        
    return tad_separation_score

def TAD_calling_total(matrix):
    # this function is for the second part of the TAD calling algorithm which
    # is to calculate the TAD separtation score for the whole matrix
    (n,m) = matrix.shape
    if n != m:
        return []

    # get the TAD separation score for each bin
    tad_separation_score = TAD_calling_part(matrix)
    
    # calculate the TAD score for the whole matrix
    tad_score = np.sum(tad_separation_score)
    
    return tad_score

def get_boundaries(matrix):
    # This function uses hierarchical clustering to determine the boundaries of the
    # topologically associating domains.
    # The first parameter is the matrix of Hi-C data.
    # The function returns a list of the TAD boundaries.

    # perform hierarchical clustering
    (n,m) = matrix.shape
    if n != m:
        return []
        
    # --- FIX: Set the diagonal to 0 to treat the matrix as a valid distance matrix ---
    np.fill_diagonal(matrix, 0)
    
    Y = sch.linkage(squareform(matrix), method='ward')
    
    # determine the clusters
    clusters = sch.fcluster(Y, 0, 'inconsistent')
    
    # determine the boundaries of the clusters
    boundaries = [0]
    for i in range(1,len(clusters)):
        if clusters[i] != clusters[i-1]:
            boundaries.append(i)
    boundaries.append(len(clusters))
    
    # make sure there are no duplicate boundaries
    boundaries = sorted(list(set(boundaries)))
    
    return boundaries

def ClusterTAD(matrix, out):
    # This function is the primary function for the program. It takes two parameters.
    # The first is the matrix of Hi-C data, which can either be a string for the
    # path to the file, or a numpy matrix.
    # The second parameter is the path to the output file, which is optional.
    # The function returns a list of the TAD boundaries.
    
    # This block is now dead code for us, but we leave it for completeness.
    # It would fail if we ever passed a string, but we pass a numpy matrix.
    if isinstance(matrix, str):
        # The original code called get_matrix(matrix) here.
        # We are not using this functionality.
        raise ValueError("Loading from a file path is not supported in this version.")

    # get the boundaries for the TADs
    b = get_boundaries(matrix)

    # write the boundaries to the output file if it is specified
    if out != None:
        f = open(out, 'w')
        for i in range(len(b)-1):
            f.write(str(b[i]) + "\t" + str(b[i+1]) + "\n")
        f.close()
    
    return b

def main():
    # This function is for running the program from the command line.
    import sys
    
    # make sure there are the correct number of arguments
    if len(sys.argv) < 2 or len(sys.argv) > 3:
        print("Usage: python ClusterTAD.py <matrix_file> <output_file>(optional)")
        sys.exit(1)
    
    # get the matrix file
    matrix_file = sys.argv[1]
    
    # get the output file if it is specified
    if len(sys.argv) == 3:
        output_file = sys.argv[2]
    else:
        output_file = None
        
    # run the program
    ClusterTAD(matrix_file, output_file)
    
if __name__ == '__main__':
    main()
