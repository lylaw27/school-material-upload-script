import { generateObject } from 'ai';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';

// Load environment variables
dotenv.config();

const v4api = createOpenAICompatible({
  name: 'v4api',
  apiKey: process.env.OPENAI_API_KEY!,
  baseURL: "https://api.gpt.ge/v1"
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== CONFIGURATION SECTION =====
const CONFIG = {
  // Subject configuration
  subjectName: 'DSE Mathematics (Geometry)',
  
  // Topics to process (process one at a time to avoid memory issues)
  topics: [
    'Circle Theorems',
    // 'Triangle Properties',
    // 'Angle Properties',
    // 'Coordinate Geometry',
  ],
  
  // Number of questions to generate per topic (reduce if memory issues occur)
  numberOfQuestionsToGenerate: 1,
  
  // Difficulty level
  difficulty: 'mixed' as 'easy' | 'medium' | 'hard' | 'mixed',
  
  // Output directory
  outputDir: path.join(__dirname, '..'),
};
// ===== END CONFIGURATION SECTION =====

// Zod schemas for geometry properties
const PointSchema = z.object({
  label: z.string().describe('Point label (e.g., A, B, C)'),
  x: z.number().optional().describe('X-coordinate (if applicable)'),
  y: z.number().optional().describe('Y-coordinate (if applicable)'),
  description: z.string().optional().describe('Description of the point'),
});

const LineSchema = z.object({
  label: z.string().describe('Line label (e.g., AB, l)'),
  points: z.array(z.string()).describe('Points on the line'),
  length: z.number().optional().describe('Length of the line segment'),
  properties: z.array(z.string()).optional().describe('Properties (e.g., parallel, perpendicular)'),
});

const CircleSchema = z.object({
  label: z.string().describe('Circle label (e.g., O, C)'),
  center: z.string().describe('Center point label'),
  radius: z.number().optional().describe('Radius value'),
  points_on_circle: z.array(z.string()).optional().describe('Points on the circumference'),
});

const AngleSchema = z.object({
  label: z.string().describe('Angle label (e.g., ∠ABC, ∠x)'),
  vertex: z.string().describe('Vertex point'),
  arms: z.array(z.string()).describe('Two arms of the angle'),
  measure: z.number().optional().describe('Angle measure in degrees'),
  angle_type: z.enum(['acute', 'right', 'obtuse', 'straight', 'reflex', 'unknown']).optional(),
});

const TriangleSchema = z.object({
  label: z.string().describe('Triangle label (e.g., △ABC)'),
  vertices: z.array(z.string()).length(3).describe('Three vertices'),
  sides: z.array(z.string()).optional().describe('Side labels'),
  angles: z.array(z.string()).optional().describe('Angle labels'),
  triangle_type: z.enum(['equilateral', 'isosceles', 'scalene', 'right', 'unknown']).optional(),
});

const GeometryPropertiesSchema = z.object({
  points: z.array(PointSchema).describe('All points in the diagram'),
  lines: z.array(LineSchema).optional().describe('Lines and line segments'),
  circles: z.array(CircleSchema).optional().describe('Circles in the diagram'),
  angles: z.array(AngleSchema).optional().describe('Angles in the diagram'),
  triangles: z.array(TriangleSchema).optional().describe('Triangles in the diagram'),
  given_conditions: z.array(z.string()).describe('Given conditions in the problem'),
  diagram_description: z.string().describe('Text description of the diagram'),
});

// Zod schema for math MCQ
const MathMCQSchema = z.object({
  question: z.string().describe('The multiple choice question text'),
  options: z.object({
    A: z.string().describe('Option A'),
    B: z.string().describe('Option B'),
    C: z.string().describe('Option C'),
    D: z.string().describe('Option D'),
  }).describe('Four options for the question'),
  correct_answer: z.enum(['A', 'B', 'C', 'D']).describe('The correct answer (A, B, C, or D)'),
  explanation: z.string().describe('Detailed step-by-step explanation with mathematical reasoning'),
  difficulty: z.number().int().min(1).max(5).describe('Difficulty level from 1 (easiest) to 5 (hardest)'),
  topic: z.string().describe('The topic this question relates to'),
  question_type: z.enum(['calculation', 'proof', 'application', 'conceptual']).describe('Type of mathematical question'),
  geometry_properties: GeometryPropertiesSchema.describe('Structured geometric properties of the diagram'),
  required_theorems: z.array(z.string()).describe('Theorems or concepts needed to solve'),
});

// Schema for multiple MCQs
const MathMCQsSchema = z.array(MathMCQSchema).describe('Array of generated math geometry questions');

type GeneratedMathMCQ = z.infer<typeof MathMCQSchema>;
type GeneratedMathMCQs = z.infer<typeof MathMCQsSchema>;

/**
 * Generate math geometry MCQs using AI
 */
async function generateMathMCQs(
  topic: string,
  numberOfQuestions: number,
  difficulty: 'easy' | 'medium' | 'hard' | 'mixed'
): Promise<{ mcqs: GeneratedMathMCQs; tokensUsed: number }> {
  try {
    const difficultyGuidance = {
      easy: '所有題目應該是基礎難度（1-2/5），適合初學者，著重基本概念和簡單計算。',
      medium: '所有題目應該是中等難度（3/5），適合一般學生，需要運用定理和推理。',
      hard: '所有題目應該是高難度（4-5/5），適合進階學生，需要多步驟推理和綜合應用。',
      mixed: '難度分佈要均衡（簡單、中等、困難都要有），覆蓋不同程度學生。'
    }[difficulty];
    
    const topicGuidance = {
      'Circle Theorems': `
重點定理：
- 圓周角定理 (angles in the same segment)
- 圓心角定理 (angle at center is twice angle at circumference)
- 切線性質 (tangent perpendicular to radius)
- 弦的性質 (perpendicular from center bisects chord)
- 圓內接四邊形 (opposite angles supplementary)`,
      'Triangle Properties': `
重點概念：
- 三角形內角和 (sum of angles = 180°)
- 外角定理 (exterior angle theorem)
- 等腰三角形性質 (isosceles triangle properties)
- 全等三角形 (congruent triangles)
- 相似三角形 (similar triangles)`,
      'Angle Properties': `
重點概念：
- 對頂角 (vertically opposite angles)
- 平行線性質 (alternate angles, corresponding angles)
- 同位角、內錯角、同旁內角
- 多邊形內角和
- 角平分線性質`,
      'Coordinate Geometry': `
重點概念：
- 距離公式 (distance formula)
- 中點公式 (midpoint formula)
- 斜率 (slope/gradient)
- 直線方程 (equation of straight line)
- 圓的方程 (equation of circle)`,
    }[topic] || '';
    
    // @ts-ignore - avoiding deep type instantiation error
    const result = await generateObject({
      model: v4api('gemini-3-flash-preview'),
      schema: MathMCQsSchema,
      messages: [
        {
          role: 'user',
          content: `你是一個專業的DSE數學科（幾何）試題出題專家。請針對「${topic}」主題生成 ${numberOfQuestions} 道高質量的幾何選擇題。

【主題重點】
${topicGuidance}

【出題要求】
1. 每道題目必須有完整的幾何圖形描述
2. 必須包含結構化的幾何屬性（點、線、圓、角等）
3. 每道題目有4個選項（A, B, C, D）
4. ${difficultyGuidance}
5. 題目類型可以是：
   - calculation: 計算題（求角度、長度、面積等）
   - proof: 證明題（證明某個關係或性質）
   - application: 應用題（實際情境）
   - conceptual: 概念題（理解定理和性質）

【幾何屬性結構要求】
每道題目必須包含詳細的 geometry_properties，包括：
- points: 所有點的資訊（標籤、座標、描述）
- lines: 線段資訊（標籤、端點、長度、性質）
- circles: 圓的資訊（標籤、圓心、半徑、圓上的點）
- angles: 角的資訊（標籤、頂點、兩臂、度數、類型）
- triangles: 三角形資訊（標籤、頂點、類型）
- given_conditions: 題目給定的條件列表
- diagram_description: 圖形的文字描述

【範例題目結構】
{
  "question": "如圖所示，圓O的圓心為O，點A、B、C在圓上。若∠AOB = 80°，求∠ACB的度數。",
  "options": {
    "A": "20°",
    "B": "40°",
    "C": "80°",
    "D": "160°"
  },
  "correct_answer": "B",
  "explanation": "根據圓周角定理，圓心角是圓周角的兩倍。因此，∠ACB = ∠AOB ÷ 2 = 80° ÷ 2 = 40°。",
  "difficulty": 2,
  "topic": "Circle Theorems",
  "question_type": "calculation",
  "geometry_properties": {
    "points": [
      {"label": "O", "description": "圓心"},
      {"label": "A", "description": "圓上的點"},
      {"label": "B", "description": "圓上的點"},
      {"label": "C", "description": "圓上的點"}
    ],
    "circles": [
      {
        "label": "Circle O",
        "center": "O",
        "points_on_circle": ["A", "B", "C"]
      }
    ],
    "angles": [
      {
        "label": "∠AOB",
        "vertex": "O",
        "arms": ["OA", "OB"],
        "measure": 80,
        "angle_type": "acute"
      },
      {
        "label": "∠ACB",
        "vertex": "C",
        "arms": ["CA", "CB"],
        "angle_type": "unknown"
      }
    ],
    "given_conditions": [
      "點A、B、C在圓O上",
      "∠AOB = 80°"
    ],
    "diagram_description": "圓O，圓心為O，點A、B、C在圓周上，OA和OB為半徑，∠AOB為圓心角，∠ACB為圓周角，兩角對應相同的弧AB"
  },
  "required_theorems": ["圓周角定理", "圓心角與圓周角的關係"]
}

【特別注意】
1. 確保幾何屬性完整且一致
2. 點、線、角的標籤要統一
3. 給定條件要清晰列出
4. 圖形描述要詳細，讓讀者能想像出圖形
5. 解釋要包含詳細的推理步驟
6. 選項要有合理的迷惑性

請生成 ${numberOfQuestions} 道符合以上要求的幾何選擇題，主題為「${topic}」。`,
        },
      ],
    });
    
    const tokensUsed = result.usage?.totalTokens || 0;
    console.log(`  ℹ Tokens used: ${tokensUsed}`);
    
    return {
      mcqs: result.object as GeneratedMathMCQs,
      tokensUsed: tokensUsed,
    };
  } catch (error) {
    console.error('Error generating math MCQs:', error);
    throw error;
  }
}

/**
 * Save generated math MCQs to JSON and txt files
 */
async function saveMathMCQsToFiles(
  mcqs: GeneratedMathMCQs,
  outputDir: string,
  topic: string
): Promise<void> {
  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true });
  
  // Save as JSON (structured data)
  const jsonPath = path.join(outputDir, `${topic.replace(/\s+/g, '-').toLowerCase()}.json`);
  await fs.writeFile(jsonPath, JSON.stringify(mcqs, null, 2), 'utf-8');
  console.log(`  ✓ JSON saved to: ${jsonPath}`);
  
  // Save as readable text file
  const txtPath = path.join(outputDir, `${topic.replace(/\s+/g, '-').toLowerCase()}.txt`);
  let content = '=== GENERATED MATH GEOMETRY QUESTIONS ===\n';
  content += `Generated: ${new Date().toISOString()}\n`;
  content += `Topic: ${topic}\n`;
  content += `Total Questions: ${mcqs.length}\n`;
  content += '='.repeat(80) + '\n\n';
  
  mcqs.forEach((mcq, index) => {
    content += `Question ${index + 1}:\n`;
    content += `${mcq.question}\n\n`;
    
    // Diagram description
    content += `[Diagram Description]\n`;
    content += `${mcq.geometry_properties.diagram_description}\n\n`;
    
    // Given conditions
    content += `[Given Conditions]\n`;
    mcq.geometry_properties.given_conditions.forEach((cond, idx) => {
      content += `  ${idx + 1}. ${cond}\n`;
    });
    content += '\n';
    
    // Options
    content += `A. ${mcq.options.A}\n`;
    content += `B. ${mcq.options.B}\n`;
    content += `C. ${mcq.options.C}\n`;
    content += `D. ${mcq.options.D}\n\n`;
    
    // Answer and explanation
    content += `Correct Answer: ${mcq.correct_answer}\n`;
    content += `Explanation: ${mcq.explanation}\n\n`;
    
    // Metadata
    content += `[Metadata]\n`;
    content += `Difficulty: ${mcq.difficulty}/5\n`;
    content += `Type: ${mcq.question_type}\n`;
    content += `Required Theorems: ${mcq.required_theorems.join(', ')}\n\n`;
    
    // Geometry properties summary
    content += `[Geometry Properties]\n`;
    content += `Points: ${mcq.geometry_properties.points.map(p => p.label).join(', ')}\n`;
    if (mcq.geometry_properties.lines) {
      content += `Lines: ${mcq.geometry_properties.lines.map(l => l.label).join(', ')}\n`;
    }
    if (mcq.geometry_properties.circles) {
      content += `Circles: ${mcq.geometry_properties.circles.map(c => c.label).join(', ')}\n`;
    }
    if (mcq.geometry_properties.angles) {
      content += `Angles: ${mcq.geometry_properties.angles.map(a => a.label).join(', ')}\n`;
    }
    if (mcq.geometry_properties.triangles) {
      content += `Triangles: ${mcq.geometry_properties.triangles.map(t => t.label).join(', ')}\n`;
    }
    
    content += '-'.repeat(80) + '\n\n';
  });
  
  await fs.writeFile(txtPath, content, 'utf-8');
  console.log(`  ✓ Text file saved to: ${txtPath}`);
}

/**
 * Generate MCQs for a single topic
 */
async function generateMathMCQsForTopic(topic: string): Promise<void> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Processing Topic: ${topic}`);
  console.log('='.repeat(80));
  
  // Generate MCQs using AI
  console.log(`\nGenerating ${CONFIG.numberOfQuestionsToGenerate} geometry questions...`);
  console.log(`Difficulty level: ${CONFIG.difficulty}`);
  
  const { mcqs, tokensUsed } = await generateMathMCQs(
    topic,
    CONFIG.numberOfQuestionsToGenerate,
    CONFIG.difficulty
  );
  
  console.log(`  ✓ Generated ${mcqs.length} question(s)`);
  console.log(`  ℹ Total tokens used: ${tokensUsed}`);
  
  // Save to files
  console.log('\nSaving questions to files...');
  await saveMathMCQsToFiles(mcqs, CONFIG.outputDir, topic);
  
  // Summary
  console.log(`\n--- Summary for ${topic} ---`);
  console.log(`Questions generated: ${mcqs.length}`);
  console.log(`Tokens used: ${tokensUsed}`);
  
  // Display geometry properties summary
  const totalPoints = mcqs.reduce((sum, mcq) => sum + mcq.geometry_properties.points.length, 0);
  const totalCircles = mcqs.reduce((sum, mcq) => sum + (mcq.geometry_properties.circles?.length || 0), 0);
  const totalAngles = mcqs.reduce((sum, mcq) => sum + (mcq.geometry_properties.angles?.length || 0), 0);
  
  console.log(`Total points across all questions: ${totalPoints}`);
  console.log(`Total circles: ${totalCircles}`);
  console.log(`Total angles: ${totalAngles}`);
}

/**
 * Main function
 */
async function generateMathGeometryQuestions() {
  console.log('=== Math Geometry MCQ Generator ===\n');
  console.log('Configuration:');
  console.log(`  Subject: ${CONFIG.subjectName}`);
  console.log(`  Topics: ${CONFIG.topics.join(', ')}`);
  console.log(`  Questions per Topic: ${CONFIG.numberOfQuestionsToGenerate}`);
  console.log(`  Difficulty: ${CONFIG.difficulty}`);
  console.log(`  Output Directory: ${CONFIG.outputDir}\n`);
  
  let totalGenerated = 0;
  let totalTokens = 0;
  
  for (const topic of CONFIG.topics) {
    try {
      await generateMathMCQsForTopic(topic);
      totalGenerated += CONFIG.numberOfQuestionsToGenerate;
    } catch (error) {
      console.error(`\n✗ Failed to process topic "${topic}":`, error);
    }
  }
  
  // Final summary
  console.log('\n' + '='.repeat(80));
  console.log('=== Final Summary ===');
  console.log(`Topics processed: ${CONFIG.topics.length}`);
  console.log(`Total questions generated: ${totalGenerated}`);
  console.log(`Output directory: ${CONFIG.outputDir}`);
  console.log('\n✓ All topics completed successfully!');
  console.log('\nNote: Questions are saved locally and NOT uploaded to Supabase.');
}

// Run the script
generateMathGeometryQuestions()
  .then(() => {
    console.log('\nScript finished.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Script failed:', error);
    process.exit(1);
  });
