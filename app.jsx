import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import * as d3 from 'd3';
import PathwayGraph from './PathwayGraph';
import './App.css';

// useResizeObserver and GeneInfoPanel components are unchanged...
const useResizeObserver = (ref) => {
    const [dimensions, setDimensions] = useState(null);
    useLayoutEffect(() => {
        const observeTarget = ref.current;
        const resizeObserver = new ResizeObserver(entries => {
            entries.forEach(entry => setDimensions(entry.contentRect));
        });
        if (observeTarget) {
            resizeObserver.observe(observeTarget);
        }
        return () => {
            if (observeTarget) {
                resizeObserver.unobserve(observeTarget);
            }
        };
    }, [ref]);
    return dimensions;
};

function GeneInfoPanel({ gene, onClose }) {
  // This component is unchanged
  const [geneDetails, setGeneDetails] = useState(null);
  const [pathwayGraph, setPathwayGraph] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [pathwayStatus, setPathwayStatus] = useState('idle');

  useEffect(() => {
    setGeneDetails(null);
    setPathwayGraph(null);
    setPathwayStatus('idle');
    setIsLoading(true);
    if (!gene || !gene.name) {
      setIsLoading(false);
      return;
    }
    let ensemblId;
    fetch(`https://rest.ensembl.org/lookup/symbol/homo_sapiens/${gene.name}?content-type=application/json`)
      .then(response => {
        if (!response.ok) throw new Error('Gene not found in ENSEMBL');
        return response.json();
      })
      .then(data => {
        setGeneDetails(data);
        setIsLoading(false);
        setPathwayStatus('loading');
        ensemblId = data.id;
        return fetch(`https://reactome.org/ContentService/data/pathways/low/entity/${ensemblId}/allforms?species=9606`);
      })
      .then(response => {
        if (!response.ok) return [];
        return response.json();
      })
      .then(pathwayData => {
        if (pathwayData && pathwayData.length > 0) {
          const firstPathwayId = pathwayData[0].stId;
          return fetch(`https://reactome.org/ContentService/data/diagram/entity/${ensemblId}/allforms?flg=${firstPathwayId}`);
        }
        setPathwayStatus('no_data');
        return null;
      })
      .then(response => {
        if (!response) return;
        if (!response.ok) throw new Error('Could not fetch pathway diagram');
        return response.json();
      })
      .then(graphData => {
        if (graphData) {
          const nodes = graphData.nodes.map(n => ({ id: n.dbId, name: n.displayName, type: n.schemaClass }));
          const edges = graphData.edges.map(e => ({ source: e.from, target: e.to }));
          setPathwayGraph({ nodes, edges });
          setPathwayStatus('success');
        }
      })
      .catch(err => {
        console.error("Error fetching details:", err);
        setIsLoading(false);
        setPathwayStatus('error');
      });
  }, [gene]);

  if (!gene) return null;
  return (
    <div className="info-panel">
      <button onClick={onClose} className="close-btn">&times;</button>
      <h3>{gene.name || 'Gene Info'}</h3>
      <p><strong>Coords:</strong> {gene.chrom}:{gene.start}-{gene.end}</p>
      {isLoading && <p><em>Loading...</em></p>}
      {geneDetails && <p><strong>Desc:</strong> {geneDetails.description || 'N/A'}</p>}
      {geneDetails && <p><strong>Biotype:</strong> <span className="biotype-badge">{geneDetails.biotype}</span></p>}
      <div className="pathway-section">
        <strong>Pathway Diagram:</strong>
        {pathwayStatus === 'loading' && <p><em>Loading pathway...</em></p>}
        {pathwayStatus === 'error' && <p>Could not fetch pathway.</p>}
        {pathwayStatus === 'no_data' && <p><em>No pathway data.</em></p>}
        {pathwayStatus === 'success' && pathwayGraph && (<PathwayGraph graphData={pathwayGraph} selectedGeneId={geneDetails?.id} />)}
      </div>
    </div>
  );
}

function GeneTracksView() {
  // This component is unchanged
  const [bedData, setBedData] = useState(null);
  const [fileName, setFileName] = useState('');
  const [selectedGene, setSelectedGene] = useState(null);
  const svgRef = useRef();
  const containerRef = useRef();
  const dimensions = useResizeObserver(containerRef);

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (!file) { setBedData(null); setFileName(''); return; }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      let parsedData = [];
      if (file.name.endsWith('.bed')) {
        parsedData = content.split('\n').filter(line => line.trim() !== '' && !line.startsWith('#')).map(line => {
          const [chrom, start, end, name, score] = line.split('\t');
          return { chrom, start: +start, end: +end, name: name || '', score: score ? +score : 0 };
        });
      } else if (file.name.endsWith('.gff') || file.name.endsWith('.gtf')) {
        parsedData = content.split('\n').filter(line => line.trim() !== '' && !line.startsWith('#')).map(line => {
          const parts = line.split('\t');
          const attributes = parts[8];
          let name = '';
          const nameMatch = attributes.match(/Name=([^;]+)/) || attributes.match(/gene_name "([^"]+)"/);
          if (nameMatch) { name = nameMatch[1]; }
          return { chrom: parts[0], start: +parts[3], end: +parts[4], name: name, score: parts[5] !== '.' ? +parts[5] : 0 };
        });
      }
      setBedData(parsedData);
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    if (!bedData || !dimensions) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    const { width } = dimensions;
    const height = width * 0.5;
    svg.attr('width', width).attr('height', height);
    const margin = { top: 20, right: 30, bottom: 40, left: 90 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;
    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    const dataByChrom = d3.group(bedData, d => d.chrom);
    const chromosomes = Array.from(dataByChrom.keys());
    const minCoord = d3.min(bedData, d => d.start);
    const maxCoord = d3.max(bedData, d => d.end);
    const padding = (maxCoord - minCoord) * 0.1;
    const xScale = d3.scaleLinear().domain([minCoord - padding, maxCoord + padding]).range([0, chartWidth]);
    const yScale = d3.scaleBand().domain(chromosomes).range([0, chartHeight]).padding(0.3);
    const chromGroups = g.selectAll(".chromosome").data(chromosomes).enter().append("g").attr("transform", d => `translate(0, ${yScale(d)})`);
    chromGroups.append("line").attr("x1", 0).attr("x2", chartWidth).attr("y1", yScale.bandwidth() / 2).attr("y2", yScale.bandwidth() / 2).attr("stroke", "#ccc");
    chromGroups.selectAll("rect").data(d => dataByChrom.get(d)).enter().append("rect").attr("x", d => xScale(d.start)).attr("y", 0).attr("width", d => Math.max(1, xScale(d.end) - xScale(d.start))).attr("height", yScale.bandwidth()).attr("fill", "steelblue").style("cursor", "pointer").on("click", (event, d) => setSelectedGene(d));
    g.append("g").attr("transform", `translate(0, ${chartHeight})`).call(d3.axisBottom(xScale).ticks(5).tickFormat(d3.format(".2s")));
    g.append("g").call(d3.axisLeft(yScale));
  }, [bedData, dimensions]);

  return (
    <div>
      <div className="file-upload-container">
        <label htmlFor="file-upload" className="file-upload-label">Browse Files</label>
        <span className="file-name">{fileName || " No file selected."}</span>
        <input type="file" id="file-upload" accept=".bed,.gff,.gtf" onChange={handleFileChange} />
      </div>
      <div className="visualization-container" ref={containerRef}>
        <GeneInfoPanel gene={selectedGene} onClose={() => setSelectedGene(null)} />
        <h3>{bedData ? "Chromosome Tracks" : "Upload a file to visualize"}</h3>
        <svg ref={svgRef}></svg>
      </div>
    </div>
  );
}


function HiCHeatmapView({ setTooltip }) {
  const canvasRef = useRef(null);
  const xAxisRef = useRef(null);
  const yAxisRef = useRef(null);
  const compartmentRef = useRef(null);
  const containerRef = useRef(null);
  const dimensions = useResizeObserver(containerRef);
  
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('idle');
  const [tads, setTads] = useState(null);
  const [compartments, setCompartments] = useState(null);
  const [matrixData, setMatrixData] = useState(null);
  
  const [tileCoords, setTileCoords] = useState({ zoom: 0, x: 0, y: 0 });
  const [transform, setTransform] = useState(d3.zoomIdentity);
  const [tadMethod, setTadMethod] = useState('insulation');

  const handleFindTADs = () => {
    const resolution = [10000, 20000, 40000, 80000, 160000, 320000, 640000, 1280000, 2560000, 5120000][tileCoords.zoom];
    const start = tileCoords.x * 256 * resolution;
    const end = (tileCoords.x + 1) * 256 * resolution;
    const region = `chr2:${start}-${end}`;

    fetch(`http://localhost:5000/api/v1/tads`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ region: region, method: tadMethod }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setTads(data);
      })
      .catch(err => {
        console.error("TAD fetch error:", err);
        setError('Failed to fetch TADs.');
      });
  };

  const handleFindCompartments = () => {
    const resolution = [10000, 20000, 40000, 80000, 160000, 320000, 640000, 1280000, 2560000, 5120000][tileCoords.zoom];
    const start = tileCoords.x * 256 * resolution;
    const end = (tileCoords.x + 1) * 256 * resolution;
    
    fetch(`http://localhost:5000/api/v1/compartments?region=chr2:${start}-${end}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setCompartments(data);
      })
      .catch(err => {
        console.error("Compartment fetch error:", err);
        setError('Failed to fetch A/B compartments.');
      });
  };

  useEffect(() => {
    setStatus('fetching');
    setError(null);
    setTads(null);
    setCompartments(null);
    fetch(`http://localhost:5000/api/v1/tiles/${tileCoords.zoom}/${tileCoords.x}/${tileCoords.y}`)
      .then(res => res.json())
      .then(tileData => {
        setMatrixData(tileData.data);
        setStatus('rendered');
      })
      .catch(err => setError("Could not connect to the backend server."));
  }, [tileCoords]);

  useEffect(() => {
    if (!matrixData || !dimensions) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { width } = dimensions;
    const size = width - 50;
    canvas.width = size;
    canvas.height = size;

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    const numBins = matrixData.length;
    if (numBins === 0) { ctx.restore(); return; }
    
    const pixelSize = size / numBins;
    const color = d3.scaleSequential(d3.interpolateYlOrRd).domain([0, d3.quantile(matrixData.flat().filter(v => v > 0), 0.95) || 1]);

    for (let i = 0; i < numBins; i++) {
      for (let j = 0; j < numBins; j++) {
        const value = matrixData[i][j];
        if (value !== null && value > 0) {
          ctx.fillStyle = color(value);
          ctx.fillRect(j * pixelSize, i * pixelSize, pixelSize, pixelSize);
        }
      }
    }
    
    const resolution = [10000, 20000, 40000, 80000, 160000, 320000, 640000, 1280000, 2560000, 5120000][tileCoords.zoom];
    const viewStart = tileCoords.x * 256 * resolution;

    if (tads) {
        ctx.strokeStyle = 'rgba(0, 0, 255, 0.7)';
        ctx.lineWidth = 2 / transform.k;
        tads.forEach(tad => {
            const x = ((tad.start - viewStart) / resolution) * pixelSize;
            const y = x;
            const tadSize = ((tad.end - tad.start) / resolution) * pixelSize;
            if (x >= 0 && (x + tadSize) <= size) {
                ctx.strokeRect(x, y, tadSize, tadSize);
            }
        });
    }

    ctx.restore();
    
    const genomicExtent = (size / transform.k) * resolution;
    const startCoord = viewStart - (transform.x / transform.k) * resolution;
    const endCoord = startCoord + genomicExtent;

    const xScale = d3.scaleLinear().domain([startCoord, endCoord]).range([0, size]);
    const yScale = d3.scaleLinear().domain([startCoord, endCoord]).range([0, size]);

    const xAxis = d3.axisBottom(xScale).ticks(5).tickFormat(d3.format(".2s"));
    const yAxis = d3.axisLeft(yScale).ticks(5).tickFormat(d3.format(".2s"));

    d3.select(xAxisRef.current).selectAll("*").remove();
    d3.select(xAxisRef.current).append("g").call(xAxis);
    
    d3.select(yAxisRef.current).selectAll("*").remove();
    d3.select(yAxisRef.current).append("g").attr("transform", `translate(49, 0)`).call(yAxis);

    const compartmentSvg = d3.select(compartmentRef.current);
    compartmentSvg.selectAll("*").remove();
    if (compartments) {
        const compartmentColor = d3.scaleOrdinal().domain([-1, 1]).range(['blue', 'red']);
        compartmentSvg.selectAll('rect')
            .data(compartments)
            .enter()
            .append('rect')
            .attr('x', d => xScale(d.start))
            .attr('y', 0)
            .attr('width', d => Math.max(1, xScale(d.end) - xScale(d.start)))
            .attr('height', 20)
            .attr('fill', d => compartmentColor(Math.sign(d.E1)));
    }

  }, [matrixData, dimensions, transform, tads, compartments, tileCoords]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const zoom = d3.zoom()
      .scaleExtent([1, 64])
      .on('zoom', (event) => {
        const newZoomLevel = Math.min(9, Math.max(0, Math.floor(Math.log2(event.transform.k))));
        if (newZoomLevel !== tileCoords.zoom) {
            setTileCoords({ zoom: newZoomLevel, x: 0, y: 0 });
        }
        setTransform(event.transform);
      });

    d3.select(canvas).call(zoom);

    const handleMouseMove = (event) => {
        if (!matrixData || matrixData.length === 0) return;
        const rect = canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        
        const inverted = transform.invert([mouseX, mouseY]);
        const numBins = matrixData.length;
        const pixelSize = canvas.width / numBins;
        const resolution = [10000, 20000, 40000, 80000, 160000, 320000, 640000, 1280000, 2560000, 5120000][tileCoords.zoom];
        const viewStart = tileCoords.x * 256 * resolution;

        // --- NEW: TAD Hit Detection Logic ---
        if (tads) {
            for (const tad of tads) {
                const tadX_px = ((tad.start - viewStart) / resolution) * pixelSize;
                const tadSize_px = ((tad.end - tad.start) / resolution) * pixelSize;

                // Check if mouse is within the bounds of this TAD rectangle
                if (inverted[0] >= tadX_px && inverted[0] <= tadX_px + tadSize_px &&
                    inverted[1] >= tadX_px && inverted[1] <= tadX_px + tadSize_px) 
                {
                    const content = `TAD: ${d3.format(".3s")(tad.start)} - ${d3.format(".3s")(tad.end)}`;
                    setTooltip({ visible: true, content: content, x: event.pageX, y: event.pageY });
                    return; // Exit the function early since we found a match
                }
            }
        }
        // --- End NEW ---

        // --- Fallback to matrix score tooltip if no TAD was hovered ---
        const i = Math.floor(inverted[1] / pixelSize);
        const j = Math.floor(inverted[0] / pixelSize);

        if (i >= 0 && i < numBins && j >= 0 && j < numBins) {
            const value = matrixData[i][j];
            if (value !== null) {
                setTooltip({ visible: true, content: `Score: ${value.toFixed(2)}`, x: event.pageX, y: event.pageY });
            } else {
                setTooltip({ visible: false });
            }
        } else {
            setTooltip({ visible: false });
        }
    };
    
    const handleMouseOut = () => setTooltip({ visible: false });

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseout', handleMouseOut);

    return () => {
        canvas.removeEventListener('mousemove', handleMouseMove);
        canvas.removeEventListener('mouseout', handleMouseOut);
    }

  }, [matrixData, transform, setTooltip, tileCoords.zoom, tads]); // --- MODIFIED: Added `tads` to dependency array

  return (
    <div className="visualization-container" ref={containerRef}>
      <div className="hic-header">
        <h3>Hi-C Contact Matrix</h3>
        <div className="analysis-controls">
          <select value={tadMethod} onChange={(e) => setTadMethod(e.target.value)}>
              <option value="insulation">Insulation Score</option>
              <option value="clustertad">ClusterTAD</option>
          </select>
          <button onClick={handleFindTADs}>Find TADs</button>
          <button onClick={handleFindCompartments}>Find Compartments</button>
        </div>
      </div>
      <div className="hic-instructions">
        <p>Click and drag to pan. Use scroll wheel to zoom.</p>
      </div>
      {status === 'fetching' && <p>Loading...</p>}
      {error && <p className="error-message">{error}</p>}
      <div className="hic-chart-wrapper">
        <svg ref={yAxisRef} className="y-axis"></svg>
        <svg ref={compartmentRef} className="compartment-track"></svg>
        <canvas ref={canvasRef} className="hic-canvas"></canvas>
        <svg ref={xAxisRef} className="x-axis"></svg>
      </div>
    </div>
  );
}


function App() {
  const [currentView, setCurrentView] = useState('tracks');
  const [tooltip, setTooltip] = useState({ visible: false, content: '', x: 0, y: 0 });

  return (
    <div className="App">
      {tooltip.visible && (
        <div className="tooltip" style={{ position: 'fixed', top: tooltip.y + 10, left: tooltip.x + 10 }}>
          {tooltip.content}
        </div>
      )}
      <header className="App-header">
        <h1>Genomic Visualizer</h1>
      </header>
      <div className="view-switcher">
        <button onClick={() => setCurrentView('tracks')} disabled={currentView === 'tracks'}>
          Gene Tracks
        </button>
        <button onClick={() => setCurrentView('hic')} disabled={currentView === 'hic'}>
          Hi-C Heatmap
        </button>
      </div>
      <main>
        {currentView === 'tracks' ? 
          <GeneTracksView /> : 
          <HiCHeatmapView setTooltip={setTooltip} />
        }
      </main>
    </div>
  );
}

export default App;
