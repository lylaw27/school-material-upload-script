import { createClient } from '@supabase/supabase-js';
import { generateObject, embed } from 'ai';
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
  // Subject ID for filtering (UUID from subjects table)
  subjectId: '498833c4-dc12-4a05-b5fc-f7df9f2bd848', // DSE中文12篇範文
  subjectName: 'DSE中文12篇範文', // For display purposes only
  
  // Topics to process (array of topic names to generate MCQs for each)
  topics: [
    // '論仁論孝論君子',
    // '出師表',
    // '勸學',
    '唐詩三首',
    '宋詞三首',
    // '岳陽樓記',
    // '逍遙遊',
    // '魚我所欲也',
    // '始得西山宴遊記',
    // '廉頗藺相如列傳',
    // '六國論',
    // '師說',
    ], // e.g., ['六國論', '出師表', '勸學'] - will run generation for each topic
  
  // Question types to include (leave null for all types)
  // Examples: ['文句翻譯與名句摘錄', '情感主旨與現實啟發']
  questionTypes: null as string[] | null,
  
  description: '是日練習集',

  // Number of questions to pick from database
  numberOfQuestions: 5,
  
  // Number of MCQs to generate per topic
  numberOfMCQsToGenerate: 10,
  
  // Difficulty level for generated questions
  // Options: 'easy' (1-2), 'medium' (3), 'hard' (4-5), 'mixed' (balanced distribution)
  difficulty: 'mixed' as 'easy' | 'medium' | 'hard' | 'mixed',
  
  // Output directory for generated MCQs (will create one file per topic)
  outputDir: path.join(__dirname, '..'),
};
// ===== END CONFIGURATION SECTION =====

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

// Type definitions
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

interface TextbookContent {
  topic: string;
  content: string;
  subject_id: string;
}

// Zod schema for generated MCQ
const MCQSchema = z.object({
  question: z.string().describe('The multiple choice question text'),
  options: z.object({
    A: z.string().describe('Option A'),
    B: z.string().describe('Option B'),
    C: z.string().describe('Option C'),
    D: z.string().describe('Option D'),
  }).describe('Four options for the question'),
  correct_answer: z.enum(['A', 'B', 'C', 'D']).describe('The correct answer (A, B, C, or D)'),
  explanation: z.string().describe('Detailed explanation of why the answer is correct'),
  difficulty: z.number().int().min(1).max(5).describe('Difficulty level from 1 (easiest) to 5 (hardest)'),
  topic: z.string().describe('The topic this question relates to'),
  question_type_name: z.string().describe('The type/category of this question - must match one from the available question types'),
});

// Schema for multiple MCQs
const MCQsSchema = z.array(MCQSchema).describe('Array of generated multiple choice questions');

type GeneratedMCQ = z.infer<typeof MCQSchema>;
type GeneratedMCQs = z.infer<typeof MCQsSchema>;

interface MCQRecord extends Omit<GeneratedMCQ, 'question_type_name'> {
  question_type_id: string;
  embedding: number[];
  metadata: Record<string, any>;
  subject_id: string;
  grade_level: string;
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
  if (topic) {
    query = query.eq('topic', topic);
  }
  
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
    throw new Error('No questions found matching the criteria');
  }
  
  // Randomly sample the requested number of questions
  const shuffled = data.sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, Math.min(limit, data.length));
  
  return selected as PastPaperQuestion[];
}

/**
 * Fetch textbook content by topic
 */
async function fetchTextbookContent(subjectId: string, topic: string): Promise<TextbookContent> {
  const { data, error } = await supabase
    .from('textbooks')
    .select('topic, content, subject_id')
    .eq('subject_id', subjectId)
    .eq('topic', topic)
    .single();
  
  if (error) {
    throw new Error(`Failed to fetch textbook content: ${error.message}`);
  }
  
  return data as TextbookContent;
}

/**
 * Generate embeddings for question content
 */
async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const { embedding } = await embed({
      model: v4api.textEmbeddingModel('bge-m3'),
      value: text,
    });
    
    return embedding;
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw error;
  }
}

/**
 * Map question type name to ID
 */
function mapQuestionTypeToId(questionTypeName: string, questionTypes: QuestionType[]): string {
  const questionType = questionTypes.find(qt => qt.name === questionTypeName);
  
  if (!questionType) {
    throw new Error(`Question type "${questionTypeName}" not found in available types`);
  }
  
  return questionType.id;
}

/**
 * Upload MCQs to Supabase mcqs table and return uploaded records with IDs
 */
async function uploadMCQsToSupabase(mcqs: MCQRecord[]): Promise<Array<{ id: string; difficulty: number; question: string }>> {
  console.log('\nUploading MCQs to Supabase...');
  
  const uploadedMCQs: Array<{ id: string; difficulty: number; question: string }> = [];
  let successCount = 0;
  let errorCount = 0;
  
  for (const mcq of mcqs) {
    try {
      const { data, error } = await supabase
        .from('mcqs')
        .insert({
          topic: mcq.topic,
          question: mcq.question,
          options: mcq.options,
          correct_answer: mcq.correct_answer,
          explanation: mcq.explanation,
          difficulty: mcq.difficulty,
          subject_id: mcq.subject_id,
          grade_level: mcq.grade_level,
          question_type_id: mcq.question_type_id,
          embedding: mcq.embedding,
          metadata: mcq.metadata,
        })
        .select();
      
      if (error) {
        throw new Error(`Failed to upload MCQ: ${error.message}`);
      }
      
      console.log(`  ✓ Uploaded MCQ: ${mcq.question.substring(0, 50)}... (ID: ${data[0].id})`);
      uploadedMCQs.push({
        id: data[0].id,
        difficulty: mcq.difficulty,
        question: mcq.question,
      });
      successCount++;
    } catch (error) {
      console.error(`  ✗ Failed to upload MCQ:`, error);
      errorCount++;
    }
  }
  
  console.log(`\n✓ Upload complete: ${successCount} succeeded, ${errorCount} failed`);
  return uploadedMCQs;
}

/**
 * Create an MCQ set and link uploaded MCQs to it, sorted by difficulty
 */
async function createMCQSet(topic: string, uploadedMCQs: Array<{ id: string; difficulty: number; question: string }>, tokensUsed: number): Promise<string> {
  console.log('\nCreating MCQ set...');
  
  // Step 1: Create the mcqset
  const { data: mcqsetData, error: mcqsetError } = await supabase
    .from('mcqsets')
    .insert({
      topic: topic,
      description: CONFIG.description,
      subject_id: CONFIG.subjectId,
      tokens_used: tokensUsed,
    })
    .select()
    .single();
  
  if (mcqsetError) {
    throw new Error(`Failed to create MCQ set: ${mcqsetError.message}`);
  }
  
  console.log(`  ✓ Created MCQ set (ID: ${mcqsetData.id})`);
  
  // Step 2: Sort MCQs by difficulty (ascending order: easiest first)
  const sortedMCQs = [...uploadedMCQs].sort((a, b) => a.difficulty - b.difficulty);
  
  // Step 3: Insert records into mcqset_questions
  console.log('\nLinking MCQs to set...');
  let linkSuccessCount = 0;
  let linkErrorCount = 0;
  
  for (let i = 0; i < sortedMCQs.length; i++) {
    const mcq = sortedMCQs[i];
    try {
      const { error: linkError } = await supabase
        .from('mcqset_questions')
        .insert({
          mcqset_id: mcqsetData.id,
          mcq_id: mcq.id,
          order_index: i + 1, // 1-indexed
        });
      
      if (linkError) {
        throw new Error(`Failed to link MCQ: ${linkError.message}`);
      }
      
      console.log(`  ✓ Linked MCQ ${i + 1}/${sortedMCQs.length} (Difficulty: ${mcq.difficulty}) - ${mcq.question.substring(0, 40)}...`);
      linkSuccessCount++;
    } catch (error) {
      console.error(`  ✗ Failed to link MCQ:`, error);
      linkErrorCount++;
    }
  }
  
  console.log(`\n✓ Linking complete: ${linkSuccessCount} succeeded, ${linkErrorCount} failed`);
  return mcqsetData.id;
}

/**
 * Generate MCQs using AI based on context
 */
async function generateMCQs(
  textbookContent: TextbookContent,
  sampleQuestions: PastPaperQuestion[],
  numberOfMCQs: number,
  difficulty: 'easy' | 'medium' | 'hard' | 'mixed',
  questionTypes: QuestionType[]
): Promise<{ mcqs: GeneratedMCQs; tokensUsed: number }> {
  try {
    // Prepare context from sample questions
    const questionsContext = sampleQuestions.map((q, idx) => 
      `範例題目 ${idx + 1}:
題目: ${q.question}
答案: ${q.answer}
解析: ${q.explanation}
難度: ${q.difficulty}/5`
    ).join('\n\n');
    
    const difficultyGuidance = {
      easy: '所有題目應該是基礎難度（1-2/5），適合初學者，著重基本概念和直接理解。',
      medium: '所有題目應該是中等難度（3/5），適合一般學生，需要一定分析能力。',
      hard: '所有題目應該是高難度（4-5/5），適合進階學生，需要深入思考和綜合分析。',
      mixed: '難度分佈要均衡（簡單、中等、困難都要有），覆蓋不同程度學生。'
    }[difficulty];
    
    // Create question types list for the prompt
    const questionTypesList = questionTypes.map(qt => `- ${qt.name}`).join('\n');
    
    // @ts-ignore - avoiding deep type instantiation error
    const result = await generateObject({
      model: v4api('qwen-max-latest'),
      schema: MCQsSchema,
      messages: [
        {
          role: 'user',
          content: `你是一個專業的DSE中文科試題出題專家。請根據以下範文內容和範例題目，生成 ${numberOfMCQs} 道高質量的選擇題（MCQ）。

【範文內容】
篇目: ${textbookContent.topic}
內容:
${textbookContent.content}

【範例題目參考】
${questionsContext}

【可用的題目類型】
請為每道題目選擇最適合的類型，必須從以下列表中選擇：
${questionTypesList}

【出題要求】
1. 每道題目必須有4個選項（A, B, C, D）
2. 題目應該測試學生對範文的理解，包括但不限於：
   - 文句理解與翻譯
   - 主旨情感分析
   - 修辭手法識別
   - 文言詞彙理解
   - 作者觀點分析
   - 結構安排理解
3. 選項要有合理的迷惑性，但只有一個正確答案
4. ${difficultyGuidance}
5. 每道題目都要提供詳細的解析說明
6. 題目要參考範例題目的風格，但不要直接抄襲
7. 確保題目答案可以在範文內容中找到依據

【JSON輸出格式】
請以JSON數組格式返回，每個題目包含以下欄位：
- question (string): 題目文字
- options (object): 包含 A, B, C, D 四個選項的對象
- correct_answer (string): 正確答案（"A", "B", "C", 或 "D"）
- explanation (string): 詳細解析
- difficulty (number): 難度等級（1-5的整數）
- topic (string): 題目所屬範文篇目
- question_type_name (string): 題目類型，必須從上述可用的題目類型列表中選擇

範例格式：
[
  {
    "question": "題目內容...",
    "options": {
      "A": "選項A內容",
      "B": "選項B內容",
      "C": "選項C內容",
      "D": "選項D內容"
    },
    "correct_answer": "A",
    "explanation": "解析內容...",
    "difficulty": 3,
    "topic": "${textbookContent.topic}",
    "question_type_name": "文句翻譯與名句摘錄"
  }
]

請生成 ${numberOfMCQs} 道符合以上要求的選擇題。`,
        },
      ],
    });
    
    const tokensUsed = result.usage?.totalTokens || 0;
    console.log(`  ℹ Tokens used: ${tokensUsed}`);
    
    return {
      mcqs: result.object as GeneratedMCQs,
      tokensUsed: tokensUsed,
    };
  } catch (error) {
    console.error('Error generating MCQs:', error);
    throw error;
  }
}

/**
 * Save generated MCQs to txt file
 */
async function saveMCQsToFile(mcqs: GeneratedMCQs, outputPath: string, topic: string): Promise<void> {
  let content = '=== GENERATED MCQ QUESTIONS ===\n';
  content += `Generated: ${new Date().toISOString()}\n`;
  content += `Topic: ${topic}\n`;
  content += `Question Types: ${CONFIG.questionTypes?.join(', ') || 'All types'}\n`;
  content += `Total Questions: ${mcqs.length}\n`;
  content += '='.repeat(80) + '\n\n';
  
  mcqs.forEach((mcq, index) => {
    content += `Question ${index + 1}:\n`;
    content += `${mcq.question}\n\n`;
    content += `A. ${mcq.options.A}\n`;
    content += `B. ${mcq.options.B}\n`;
    content += `C. ${mcq.options.C}\n`;
    content += `D. ${mcq.options.D}\n\n`;
    content += `Correct Answer: ${mcq.correct_answer}\n`;
    content += `Difficulty: ${mcq.difficulty}/5\n`;
    content += `Topic: ${mcq.topic}\n`;
    content += `Question Type: ${mcq.question_type_name}\n`;
    content += `Explanation: ${mcq.explanation}\n`;
    content += '-'.repeat(80) + '\n\n';
  });
  
  await fs.writeFile(outputPath, content, 'utf-8');
  console.log(`\n✓ MCQs saved to: ${outputPath}`);
}

/**
 * Main function to generate MCQs for a single topic
 */
async function generateMCQsForTopic(topic: string, questionTypes: QuestionType[]): Promise<void> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Processing Topic: ${topic}`);
  console.log('='.repeat(80));
  
  // Step 1: Fetch random sample questions
  console.log('\nStep 1: Fetching sample questions from database...');
  const sampleQuestions = await fetchRandomQuestions(
    CONFIG.subjectId,
    topic,
    CONFIG.questionTypes,
    CONFIG.numberOfQuestions,
    questionTypes
  );
  console.log(`  ✓ Retrieved ${sampleQuestions.length} sample question(s)`);
  
  // Step 2: Fetch textbook content
  console.log('\nStep 2: Fetching textbook content...');
  const textbookContent = await fetchTextbookContent(CONFIG.subjectId, topic);
  console.log(`  ✓ Retrieved textbook content for: ${textbookContent.topic}`);
  console.log(`  ✓ Content length: ${textbookContent.content.length} characters`);
  
  // Step 3: Generate MCQs using AI
  console.log(`\nStep 3: Generating ${CONFIG.numberOfMCQsToGenerate} MCQs using AI...`);
  console.log(`  Difficulty level: ${CONFIG.difficulty}`);
  const { mcqs: generatedMCQs, tokensUsed } = await generateMCQs(
    textbookContent,
    sampleQuestions,
    CONFIG.numberOfMCQsToGenerate,
    CONFIG.difficulty,
    questionTypes
  );
  console.log(`  ✓ Generated ${generatedMCQs.length} MCQ(s)`);
  
  // Step 4: Save to file
  console.log('\nStep 4: Saving MCQs to file...');
  const outputFile = path.join(CONFIG.outputDir, `generated-mcqs-${topic}.txt`);
  await saveMCQsToFile(generatedMCQs, outputFile, topic);
  
  // Step 5: Generate embeddings and prepare records for upload
  console.log('\nStep 5: Generating embeddings and preparing records...');
  const mcqRecords: MCQRecord[] = [];
  
  for (const mcq of generatedMCQs) {
    try {
      console.log(`  → Generating embedding for: ${mcq.question.substring(0, 50)}...`);
      
      // Map question type name to ID
      const questionTypeId = mapQuestionTypeToId(mcq.question_type_name, questionTypes);
      
      // Generate embedding from question, options, and explanation
      const embeddingText = `${mcq.question}\n${Object.values(mcq.options).join('\n')}\n${mcq.explanation}`;
      const embedding = await generateEmbedding(embeddingText);
      
      // Create record
      const record: MCQRecord = {
        topic: mcq.topic,
        question: mcq.question,
        options: mcq.options,
        correct_answer: mcq.correct_answer,
        explanation: mcq.explanation,
        difficulty: mcq.difficulty,
        subject_id: CONFIG.subjectId,
        grade_level: 'DSE',
        question_type_id: questionTypeId,
        embedding: embedding,
        metadata: {
          generated_at: new Date().toISOString(),
          question_type_name: mcq.question_type_name,
          generation_config: {
            difficulty_setting: CONFIG.difficulty,
            sample_questions_used: sampleQuestions.length,
          },
        },
      };
      
      mcqRecords.push(record);
      console.log(`    ✓ Embedding generated`);
    } catch (error) {
      console.error(`    ✗ Error processing MCQ:`, error);
    }
  }
  
  // Step 6: Upload to Supabase
  if (mcqRecords.length > 0) {
    console.log(`\nStep 6: Uploading ${mcqRecords.length} MCQ(s) to Supabase...`);
    const uploadedMCQs = await uploadMCQsToSupabase(mcqRecords);
    
    // Step 7: Create MCQ set and link questions
    if (uploadedMCQs.length > 0) {
      console.log(`\nStep 7: Creating MCQ set for topic \"${topic}\"...`);
      const mcqsetId = await createMCQSet(topic, uploadedMCQs, tokensUsed);
      console.log(`  ✓ MCQ set created successfully (ID: ${mcqsetId})`);
      console.log(`  ℹ Total tokens used: ${tokensUsed}`);
    }
  }
  
  // Summary for this topic
  console.log(`\n--- Summary for ${topic} ---`);
  console.log(`Sample questions used: ${sampleQuestions.length}`);
  console.log(`MCQs generated: ${generatedMCQs.length}`);
  console.log(`MCQs uploaded: ${mcqRecords.length}`);
  console.log(`Output file: ${outputFile}`);
}

/**
 * Main function to generate MCQs for all configured topics
 */
async function generateMCQQuestions() {
  console.log('=== MCQ Generator ===\n');
  console.log('Configuration:');
  console.log(`  Subject: ${CONFIG.subjectName} (ID: ${CONFIG.subjectId})`);
  console.log(`  Topics: ${CONFIG.topics.join(', ')}`);
  console.log(`  Question Types: ${CONFIG.questionTypes?.join(', ') || 'All types'}`);
  console.log(`  Sample Questions per Topic: ${CONFIG.numberOfQuestions}`);
  console.log(`  MCQs to Generate per Topic: ${CONFIG.numberOfMCQsToGenerate}\n`);
  
  // Fetch question types once for all topics
  console.log('Fetching question types...');
  const questionTypes = await fetchQuestionTypes(CONFIG.subjectId);
  console.log(`✓ Found ${questionTypes.length} question types\n`);
  
  // Process each topic
  let totalGenerated = 0;
  let totalUploaded = 0;
  
  for (const topic of CONFIG.topics) {
    try {
      await generateMCQsForTopic(topic, questionTypes);
      totalGenerated += CONFIG.numberOfMCQsToGenerate;
      totalUploaded += CONFIG.numberOfMCQsToGenerate; // Assuming all generated MCQs are uploaded
    } catch (error) {
      console.error(`\n✗ Failed to process topic "${topic}":`, error);
    }
  }
  
  // Final summary
  console.log('\n' + '='.repeat(80));
  console.log('=== Final Summary ===');
  console.log(`Topics processed: ${CONFIG.topics.length}`);
  console.log(`Total MCQs generated: ${totalGenerated}`);
  console.log(`Total MCQs uploaded: ${totalUploaded}`);
  console.log('\n✓ All topics completed successfully!');
}

// Run the script
generateMCQQuestions()
  .then(() => {
    console.log('\nScript finished.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Script failed:', error);
    process.exit(1);
  });
