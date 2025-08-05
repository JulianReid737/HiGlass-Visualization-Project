import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

function PathwayGraph({ graphData, selectedGeneId }) {
  const svgRef = useRef();

  useEffect(() => {
    if (!graphData || !graphData.nodes) return;

    const { nodes, edges } = graphData;

    const width = 280;
    const height = 250;

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height)
      .html(''); // Clear previous graph

    const g = svg.append('g');

    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges).id(d => d.id).distance(50))
      .force('charge', d3.forceManyBody().strength(-100))
      .force('center', d3.forceCenter(width / 2, height / 2));

    const link = g.append('g')
      .selectAll('line')
      .data(edges)
      .enter().append('line')
      .style('stroke', '#999')
      .style('stroke-opacity', 0.6);

    const node = g.append('g')
      .selectAll('circle')
      .data(nodes)
      .enter().append('circle')
      .attr('r', 5)
      .style('fill', d => d.id === selectedGeneId ? '#ff7f0e' : '#1f77b4') // Highlight selected
      .style('stroke', '#fff')
      .style('stroke-width', '1.5px')
      .call(d3.drag()
          .on('start', dragstarted)
          .on('drag', dragged)
          .on('end', dragended));

    node.append('title')
      .text(d => d.name);

    simulation.on('tick', () => {
      link
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);

      node
        .attr('cx', d => d.x)
        .attr('cy', d => d.y);
    });

    function dragstarted(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event, d) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }

  }, [graphData, selectedGeneId]);

  return <svg ref={svgRef}></svg>;
}

export default PathwayGraph;
s
