import { createClient } from '@supabase/supabase-js';
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

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment variables');
}

if (!process.env.OPENAI_API_KEY) {
  throw new Error('Missing OPENAI_API_KEY in environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ===== CONFIGURATION SECTION =====
const CONFIG = {
  // Subject configuration
  subjectId: 'b1819b8e-cc76-41ac-9e01-7764faf36d89', // DSE Mathematics
  subjectName: 'DSE Mathematics (Geometry)',
  
  // Topics to process (process one at a time to avoid memory issues)
  topics: [
    'Circle Theorems',
    // 'Triangle Properties',
    // 'Angle Properties',
    // 'Coordinate Geometry',
  ],
  
  // Question types to filter sample questions (leave null for all types)
  // Examples: ['Circle Theorems', 'Triangle Properties']
  questionTypes: ['三角學','平面幾何'],
  
  // Number of sample questions to fetch from database for context
  numberOfSampleQuestions: 5,
  
  // Number of questions to generate per topic (reduce if memory issues occur)
  numberOfQuestionsToGenerate: 5,
  
  // Difficulty level
  difficulty: 'mixed' as 'easy' | 'medium' | 'hard' | 'mixed',
  
  // Output directory
  outputDir: path.join(__dirname, '..'),
};
// ===== END CONFIGURATION SECTION =====

// Zod schemas for geometry properties
const PointSchema = z.object({
  label: z.string().describe('Point label (e.g., A, B, C)'),
  x: z.number().describe('X-coordinate (if applicable)'),
  y: z.number().describe('Y-coordinate (if applicable)'),
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
  radius: z.number().describe('Radius value'),
  points_on_circle: z.array(z.string()).describe('Points on the circumference'),
});

const AngleSchema = z.object({
  label: z.string().describe('Angle label (e.g., ∠ABC, ∠x)'),
  vertex: z.string().describe('Vertex point'),
  arms: z.array(z.string()).describe('Two arms of the angle'),
  measure: z.number().describe('Angle measure in degrees'),
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
  lines: z.array(LineSchema).describe('Lines and line segments'),
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

// Type definitions for database records
interface PastPaperQuestion {
  id: string;
  topic: string;
  question: string;
  answer: string;
  question_number: number;
  question_year: number;
  subject_id: string;
  explanation: string;
  difficulty: number;
  grade_level: string;
  question_type_id: string;
}

interface QuestionType {
  id: string;
  name: string;
  subject_id: string;
}

/**
 * Fetch question types from Supabase
 */
async function fetchQuestionTypes(subjectId: string): Promise<QuestionType[]> {
  const { data, error } = await supabase
    .from('question_types')
    .select('id, name, subject_id')
    .eq('subject_id', subjectId);
  
  if (error) {
    throw new Error(`Failed to fetch question types: ${error.message}`);
  }
  
  return data as QuestionType[];
}

/**
 * Fetch random questions from pastpapers table
 */
async function fetchRandomQuestions(
  subjectId: string,
  topic: string | null,
  questionTypeNames: string[] | null,
  limit: number,
  questionTypes: QuestionType[]
): Promise<PastPaperQuestion[]> {
  let query = supabase
    .from('pastpapers')
    .select('*')
    .eq('subject_id', subjectId);
  
  // Filter by topic if specified
  // if (topic) {
  //   query = query.eq('topic', topic);
  // }
  
  // Filter by question types if specified
  if (questionTypeNames && questionTypeNames.length > 0) {
    const questionTypeIds = questionTypes
      .filter(qt => questionTypeNames.includes(qt.name))
      .map(qt => qt.id);
    
    if (questionTypeIds.length > 0) {
      query = query.in('question_type_id', questionTypeIds);
    }
  }
  
  // Fetch all matching records first, then randomly sample
  const { data, error } = await query;
  
  if (error) {
    throw new Error(`Failed to fetch questions: ${error.message}`);
  }
  
  if (!data || data.length === 0) {
    console.log('  ⚠ No sample questions found matching the criteria - proceeding without samples');
    return [];
  }
  
  // Randomly sample the requested number of questions
  const shuffled = data.sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, Math.min(limit, data.length));
  
  return selected as PastPaperQuestion[];
}

/**
 * Generate math geometry MCQs using AI
 */
async function generateMathMCQs(
  topic: string,
  numberOfQuestions: number,
  difficulty: 'easy' | 'medium' | 'hard' | 'mixed',
  sampleQuestions: PastPaperQuestion[]
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
    
    // Prepare context from sample questions (in random order for variety)
    const questionsContext = sampleQuestions.length > 0 
      ? sampleQuestions.map((q, idx) => 
        `範例題目 ${idx + 1}:
題目: ${q.question}
答案: ${q.answer}
解析: ${q.explanation}
難度: ${q.difficulty}/5`
      ).join('\n\n')
      : '（無範例題目）';
    
    // @ts-ignore - avoiding deep type instantiation error
    const result = await generateObject({
      model: 'google/gemini-3-pro-preview',
      schema: MathMCQsSchema,
      providerOptions: {
        google: {
          thinkingConfig: {
            includeThoughts: true,
            thinkingLevel: 'high',
          },
        },
      },
      messages: [
        {
          role: 'user',
          content: `你是一個專業的DSE數學科（幾何）試題出題專家。請針對「${topic}」主題生成 ${numberOfQuestions} 道高質量的幾何選擇題。

【主題重點】
${topicGuidance}

【範例題目參考】
以下是一些參考題目，請參考其風格和難度，但不要直接抄襲：
${questionsContext}

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

【重要：座標精確性要求】
⚠️ 點的座標必須在數學上準確反映所有的角度測量值和長度！
- 使用三角函數計算座標：如果角度為θ，半徑為r，則點的座標應為 (r·cos(θ), r·sin(θ))
- 驗證距離：兩點間的距離必須符合給定的長度值
- 驗證角度：由座標計算出的角度必須與 measure 欄位的數值一致
- 例如：如果∠AOB = 80°，點A在(5,0)，點B的座標必須使用 (5·cos(80°), 5·sin(80°)) ≈ (0.868, 4.924)
- 絕對不要使用任意或近似的座標值，必須精確計算！

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
      {"label": "O", "x": 0, "y": 0, "description": "圓心"},
      {"label": "A", "x": 5, "y": 0, "description": "圓上的點"},
      {"label": "B", "x": 0.868, "y": 4.924, "description": "圓上的點（由80°角度計算：5·cos(80°), 5·sin(80°)）"},
      {"label": "C", "x": 3, "y": 4, "description": "圓上的點"}
    ],
    "lines": [
      {
        "label": "OA",
        "points": ["O", "A"],
      },
      {
        "label": "OB",
        "points": ["O", "B"],
      }
    ],
    "circles": [
      {
        "label": "Circle O",
        "center": "O",
        "radius": 5,
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
        "measure": 40,
        "angle_type": "acute"
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
async function generateMathMCQsForTopic(topic: string, questionTypes: QuestionType[]): Promise<void> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Processing Topic: ${topic}`);
  console.log('='.repeat(80));
  
  // Step 1: Fetch sample questions from database
  console.log(`\nStep 1: Fetching sample questions from database...`);
  const sampleQuestions = await fetchRandomQuestions(
    CONFIG.subjectId,
    topic,
    CONFIG.questionTypes,
    CONFIG.numberOfSampleQuestions,
    questionTypes
  );
  console.log(`  ✓ Retrieved ${sampleQuestions.length} sample question(s)`);
  
  // Step 2: Generate MCQs using AI
  console.log(`\nStep 2: Generating ${CONFIG.numberOfQuestionsToGenerate} geometry questions...`);
  console.log(`Difficulty level: ${CONFIG.difficulty}`);
  
  const { mcqs, tokensUsed } = await generateMathMCQs(
    topic,
    CONFIG.numberOfQuestionsToGenerate,
    CONFIG.difficulty,
    sampleQuestions
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
  console.log(`  Subject: ${CONFIG.subjectName} (ID: ${CONFIG.subjectId})`);
  console.log(`  Topics: ${CONFIG.topics.join(', ')}`);
  console.log(`  Question Types: ${CONFIG.questionTypes?.join(', ') || 'All types'}`);
  console.log(`  Sample Questions per Topic: ${CONFIG.numberOfSampleQuestions}`);
  console.log(`  Questions per Topic: ${CONFIG.numberOfQuestionsToGenerate}`);
  console.log(`  Difficulty: ${CONFIG.difficulty}`);
  console.log(`  Output Directory: ${CONFIG.outputDir}\n`);
  
  // Fetch question types once for all topics
  console.log('Fetching question types...');
  const questionTypes = await fetchQuestionTypes(CONFIG.subjectId);
  console.log(`✓ Found ${questionTypes.length} question types\n`);
  
  let totalGenerated = 0;
  let totalTokens = 0;
  
  for (const topic of CONFIG.topics) {
    try {
      await generateMathMCQsForTopic(topic, questionTypes);
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
