import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Point {
  label: string;
  x: number;
  y: number;
  description?: string;
}

interface Line {
  label: string;
  points: string[];
  length?: number;
  properties?: string[];
}

interface Circle {
  label: string;
  center: string;
  radius: number;
  points_on_circle: string[];
}

interface Angle {
  label: string;
  vertex: string;
  arms: string[];
  measure: number;
  angle_type?: 'acute' | 'right' | 'obtuse' | 'straight' | 'reflex' | 'unknown';
}

interface Triangle {
  label: string;
  vertices: string[];
  sides?: string[];
  angles?: string[];
  triangle_type?: 'equilateral' | 'isosceles' | 'scalene' | 'right' | 'unknown';
}

interface GeometryProperties {
  points: Point[];
  lines: Line[];
  circles?: Circle[];
  angles?: Angle[];
  triangles?: Triangle[];
  given_conditions: string[];
  diagram_description: string;
}

interface MathMCQ {
  question: string;
  options: {
    A: string;
    B: string;
    C: string;
    D: string;
  };
  correct_answer: 'A' | 'B' | 'C' | 'D';
  explanation: string;
  difficulty: number;
  topic: string;
  question_type: 'calculation' | 'proof' | 'application' | 'conceptual';
  geometry_properties: GeometryProperties;
  required_theorems: string[];
}

/**
 * Generate JSXGraph HTML code for a geometry diagram
 */
function generateJSXGraphHTML(mcq: MathMCQ, questionIndex: number): string {
  const { geometry_properties } = mcq;
  const boardId = `jxgbox-${questionIndex}`;
  
  // Find bounds for the board
  const allX = geometry_properties.points.map(p => p.x);
  const allY = geometry_properties.points.map(p => p.y);
  const minX = Math.min(...allX) - 2;
  const maxX = Math.max(...allX) + 2;
  const minY = Math.min(...allY) - 2;
  const maxY = Math.max(...allY) + 2;
  
  let jsCode = `
    // Board ${questionIndex + 1}: ${mcq.topic}
    const board${questionIndex} = JXG.JSXGraph.initBoard('${boardId}', {
      boundingbox: [${minX}, ${maxY}, ${maxX}, ${minY}],
      axis: true,
      showCopyright: false,
      showNavigation: true,
      grid: false
    });
    
    // Create points
    const points${questionIndex} = {};
`;

  // Create points
  geometry_properties.points.forEach(point => {
    jsCode += `    points${questionIndex}['${point.label}'] = board${questionIndex}.create('point', [${point.x}, ${point.y}], {
      name: '${point.label}',
      size: 3,
      fillColor: '#0066cc',
      strokeColor: '#0066cc',
      label: {offset: [5, 5]}
    });
`;
  });

  // Create circles
  if (geometry_properties.circles) {
    geometry_properties.circles.forEach((circle, idx) => {
      const centerPoint = `points${questionIndex}['${circle.center}']`;
      jsCode += `
    // Circle: ${circle.label}
    board${questionIndex}.create('circle', [${centerPoint}, ${circle.radius}], {
      strokeColor: '#666',
      strokeWidth: 2,
      fillOpacity: 0
    });
`;
    });
  }

  // Create lines
  geometry_properties.lines.forEach((line, idx) => {
    if (line.points.length >= 2) {
      const p1 = line.points[0];
      const p2 = line.points[line.points.length - 1];
      const isRadius = line.properties?.includes('radius');
      
      jsCode += `    board${questionIndex}.create('segment', [points${questionIndex}['${p1}'], points${questionIndex}['${p2}']], {
      name: '${line.label}',
      strokeColor: '${isRadius ? '#ff6600' : '#333'}',
      strokeWidth: ${isRadius ? 2 : 1.5}
    });
`;
    }
  });

  // Create angles (arcs)
  if (geometry_properties.angles) {
    geometry_properties.angles.forEach((angle, idx) => {
      // Parse arms to get the two points
      const vertex = angle.vertex;
      // arms might be like ["OA", "OB"] or ["AO", "OB"]
      // We need to extract the points that are not the vertex
      const arm1Points = angle.arms[0].split('').filter(c => c !== vertex);
      const arm2Points = angle.arms[1].split('').filter(c => c !== vertex);
      
      const point1 = arm1Points.length > 0 ? arm1Points.join('') : angle.arms[0].replace(vertex, '');
      const point2 = arm2Points.length > 0 ? arm2Points.join('') : angle.arms[1].replace(vertex, '');
      
      if (point1 && point2) {
        jsCode += `
    // Angle: ${angle.label} = ${angle.measure}°
    board${questionIndex}.create('angle', [points${questionIndex}['${point1}'], points${questionIndex}['${vertex}'], points${questionIndex}['${point2}']], {
      radius: 0.8,
      fillColor: '#ffcccc',
      strokeColor: '#cc0000',
      name: '${angle.measure}°'
    });
`;
      }
    });
  }

  // Create triangles
  if (geometry_properties.triangles) {
    geometry_properties.triangles.forEach((triangle, idx) => {
      if (triangle.vertices.length === 3) {
        jsCode += `
    // Triangle: ${triangle.label}
    board${questionIndex}.create('polygon', [
      points${questionIndex}['${triangle.vertices[0]}'],
      points${questionIndex}['${triangle.vertices[1]}'],
      points${questionIndex}['${triangle.vertices[2]}']
    ], {
      fillColor: '#e6f2ff',
      fillOpacity: 0.3,
      borders: {strokeColor: '#0066cc', strokeWidth: 2}
    });
`;
      }
    });
  }

  return jsCode;
}

/**
 * Generate complete HTML file with JSXGraph visualizations
 */
function generateHTMLFile(mcqs: MathMCQ[], sourceFile: string): string {
  let html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Geometry Visualization - ${path.basename(sourceFile, '.json')}</title>
  <link rel="stylesheet" type="text/css" href="https://jsxgraph.org/distrib/jsxgraph.css" />
  <script type="text/javascript" charset="UTF-8" src="https://jsxgraph.org/distrib/jsxgraphcore.js"></script>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    h1 {
      color: #333;
      border-bottom: 3px solid #0066cc;
      padding-bottom: 10px;
    }
    .question-container {
      background: white;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 30px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .question-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 15px;
    }
    .question-title {
      font-size: 1.2em;
      font-weight: bold;
      color: #0066cc;
    }
    .difficulty-badge {
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 0.85em;
      font-weight: bold;
      color: white;
    }
    .diff-1, .diff-2 { background-color: #28a745; }
    .diff-3 { background-color: #ffc107; color: #333; }
    .diff-4, .diff-5 { background-color: #dc3545; }
    .question-text {
      font-size: 1.1em;
      margin: 15px 0;
      color: #333;
      line-height: 1.6;
    }
    .diagram-container {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin: 20px 0;
    }
    .diagram-wrapper {
      width: 100%;
      min-width: 0;
    }
    .jxgbox {
      width: 400px;
      max-width: 400px;
      height: 400px;
      border: 2px solid #ddd;
      border-radius: 4px;
      box-sizing: border-box;
      overflow: hidden;
    }
    .info-panel {
      padding: 15px;
      background-color: #f8f9fa;
      border-radius: 4px;
    }
    .info-section {
      margin-bottom: 15px;
    }
    .info-section h4 {
      margin: 0 0 8px 0;
      color: #0066cc;
      font-size: 0.95em;
    }
    .info-section p, .info-section ul {
      margin: 5px 0;
      font-size: 0.9em;
      color: #555;
    }
    .info-section ul {
      padding-left: 20px;
    }
    .options {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      margin: 15px 0;
    }
    .option {
      padding: 10px;
      background-color: #f8f9fa;
      border: 2px solid #ddd;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .option:hover {
      background-color: #e9ecef;
      border-color: #0066cc;
    }
    .option.correct {
      background-color: #d4edda;
      border-color: #28a745;
      font-weight: bold;
    }
    .explanation {
      background-color: #e7f3ff;
      border-left: 4px solid #0066cc;
      padding: 15px;
      margin: 15px 0;
      border-radius: 4px;
    }
    .explanation h4 {
      margin: 0 0 10px 0;
      color: #0066cc;
    }
    .metadata {
      display: flex;
      gap: 20px;
      margin-top: 15px;
      padding-top: 15px;
      border-top: 1px solid #ddd;
      font-size: 0.9em;
      color: #666;
    }
    .metadata-item {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .metadata-item strong {
      color: #333;
    }
  </style>
</head>
<body>
  <h1>📐 Geometry Visualization: ${path.basename(sourceFile, '.json')}</h1>
  <p style="color: #666; margin-bottom: 30px;">
    Source: <code>${sourceFile}</code> | Total Questions: ${mcqs.length}
  </p>
`;

  mcqs.forEach((mcq, index) => {
    const diffClass = `diff-${mcq.difficulty}`;
    html += `
  <div class="question-container">
    <div class="question-header">
      <div class="question-title">Question ${index + 1}</div>
      <span class="difficulty-badge ${diffClass}">Difficulty: ${mcq.difficulty}/5</span>
    </div>
    
    <div class="question-text">${mcq.question}</div>
    
    <div class="diagram-container">
      <div class="diagram-wrapper">
        <h3 style="margin-top: 0;">Interactive Diagram</h3>
        <div id="jxgbox-${index}" class="jxgbox"></div>
      </div>
      
      <div class="info-panel">
        <div class="info-section">
          <h4>📋 Given Conditions</h4>
          <ul>
${mcq.geometry_properties.given_conditions.map(cond => `<li>${cond}</li>`).join('\n')}
          </ul>
        </div>
        
        <div class="info-section">
          <h4>📐 Diagram Description</h4>
          <p>${mcq.geometry_properties.diagram_description}</p>
        </div>
        
        <div class="info-section">
          <h4>🎓 Required Theorems</h4>
          <ul>
${mcq.required_theorems.map(theorem => `<li>${theorem}</li>`).join('\n')}
          </ul>
        </div>
      </div>
    </div>
    
    <div class="options">
      <div class="option ${mcq.correct_answer === 'A' ? 'correct' : ''}">A. ${mcq.options.A}</div>
      <div class="option ${mcq.correct_answer === 'B' ? 'correct' : ''}">B. ${mcq.options.B}</div>
      <div class="option ${mcq.correct_answer === 'C' ? 'correct' : ''}">C. ${mcq.options.C}</div>
      <div class="option ${mcq.correct_answer === 'D' ? 'correct' : ''}">D. ${mcq.options.D}</div>
    </div>
    
    <div class="explanation">
      <h4>✅ Answer: ${mcq.correct_answer}</h4>
      <p>${mcq.explanation}</p>
    </div>
    
    <div class="metadata">
      <div class="metadata-item">
        <strong>Topic:</strong> ${mcq.topic}
      </div>
      <div class="metadata-item">
        <strong>Type:</strong> ${mcq.question_type}
      </div>
      <div class="metadata-item">
        <strong>Difficulty:</strong> ${mcq.difficulty}/5
      </div>
    </div>
  </div>
`;
  });

  // Add JavaScript code
  html += `
  <script>
    // Initialize all boards
    ${mcqs.map((mcq, index) => generateJSXGraphHTML(mcq, index)).join('\n')}
  </script>
</body>
</html>
`;

  return html;
}

/**
 * Read JSON file and generate HTML visualization
 */
async function visualizeGeometry(jsonFilePath: string): Promise<void> {
  try {
    console.log(`Reading JSON file: ${jsonFilePath}`);
    
    // Read JSON file
    const jsonContent = await fs.readFile(jsonFilePath, 'utf-8');
    const mcqs: MathMCQ[] = JSON.parse(jsonContent);
    
    console.log(`Found ${mcqs.length} question(s)`);
    
    // Generate HTML
    const html = generateHTMLFile(mcqs, jsonFilePath);
    
    // Save HTML file
    const outputPath = jsonFilePath.replace('.json', '.html');
    await fs.writeFile(outputPath, html, 'utf-8');
    
    console.log(`✓ HTML visualization generated: ${outputPath}`);
    console.log(`\nOpen the file in a browser to view the interactive diagrams.`);
    
  } catch (error) {
    console.error('Error visualizing geometry:', error);
    throw error;
  }
}

// Main execution
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log('Usage: npm run visualize-geometry <json-file-path>');
  console.log('Example: npm run visualize-geometry circle-theorems.json');
  process.exit(1);
}

const jsonFilePath = path.isAbsolute(args[0]) 
  ? args[0] 
  : path.join(__dirname, '..', args[0]);

visualizeGeometry(jsonFilePath)
  .then(() => {
    console.log('\n✓ Visualization complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Visualization failed:', error);
    process.exit(1);
  });
