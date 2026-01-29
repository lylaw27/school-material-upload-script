import { createClient } from '@supabase/supabase-js';
import { generateObject, generateText } from 'ai';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import { embed } from 'ai';

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
  // Subject for querying question types from Supabase
  subject: '必修數學',
  subject_id: 'b1819b8e-cc76-41ac-9e01-7764faf36d89',
  gradeLevel: 'DSE',
  
  // Folder containing past paper images
  pastpapersFolder: process.env.PASTPAPERS_FOLDER || path.join(__dirname, '..', 'pastpapers', 'images'),
  
  // Output file for review before upload
  outputFile: path.join(__dirname, '..', 'pastpapers', 'extracted-questions.txt'),
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

// Type definitions first
type PastPaperQuestion = {
  question: string;
  answer: string;
  question_number: number;
  question_year: number;
  subject: string;
  explanation: string;
  difficulty: number;
  grade_level: string;
  question_type_name: string;
};

type ExtractedQuestions = PastPaperQuestion[];

// Zod schema for a single past paper question
const PastPaperQuestionSchema = z.object({
  question: z.string().describe('The full question text extracted from the image'),
  answer: z.string().describe('The answer to the question'),
  question_number: z.number().int().describe('The question number in the exam paper'),
  question_year: z.number().int().describe('The year this question appeared in the exam (e.g., 2023)'),
  subject: z.string().describe('The subject area (e.g., DSE中文12篇範文)'),
  explanation: z.string().describe('Explanation how the question can be answered, including key points and analysis'),
  difficulty: z.number().int().min(1).max(5).describe('Difficulty level from 1 (easiest) to 5 (hardest)'),
  grade_level: z.string().describe('Grade level (e.g., DSE)'),
  question_type_name: z.string().describe('The name of the question type - must match one from the provided question types list'),
});

// Schema for multiple questions - array of questions
const ExtractedQuestionsSchema = z.array(PastPaperQuestionSchema).describe('Array of questions extracted from the image');

interface QuestionType {
  id: string;
  name: string;
  subject: string;
}

interface PastPaperRecord extends Omit<PastPaperQuestion, 'question_type_name'> {
  topic: string;
  question_type_id: string;
  embedding: number[];
  metadata: Record<string, any>;
}

/**
 * Fetch available question types from Supabase
 */
async function fetchQuestionTypes(subject: string): Promise<QuestionType[]> {
  const { data, error } = await supabase
    .from('question_types')
    .select('id, name')
    .eq('subject_id', CONFIG.subject_id);
  
  if (error) {
    throw new Error(`Failed to fetch question types: ${error.message}`);
  }
  
  return data as QuestionType[];
}

/**
 * Perform OCR on an image using vision AI
 */
async function performOCR(imagePath: string, questionTypes: QuestionType[]): Promise<ExtractedQuestions> {
  try {
    // Read image and convert to base64
    const imageBuffer = await fs.readFile(imagePath);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
    
    // Create question types list for the prompt
    const questionTypesList = questionTypes.map(qt => `- ${qt.name}`).join('\n');
    
    // @ts-ignore - avoiding deep type instantiation error
    const result = await generateObject({
      model: v4api('gemini-3-flash-preview'),
      schema: ExtractedQuestionsSchema,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `你是一個專業的DSE考試分析專家。請仔細分析這張圖片中的考題，並提取所有題目。返回一個題目數組。

對於每個題目，請提供以下資訊：
1. question: 完整的題目內容（如果包含數學公式或符號，請使用 LaTeX 格式，例如：$x^2 + y^2 = r^2$ 或 $$\\\\frac{a}{b}$$）
2. answer: 題目的答案（如果包含數學內容，同樣使用 LaTeX 格式）
3. question_number: 題號（如果圖片中有標示 (一定要是整數)
4. question_year: 年份（如果圖片中有標示）(一定要是整數)
5. subject: 科目（${CONFIG.subject}）
6. explanation: 題目解析，包含答題要點與分析（如涉及數學推導，使用 LaTeX 格式）
7. difficulty: 難度（1-5，其中1最簡單，5最難，一定要是整數）
8. grade_level: DSE
9. question_type_name: 題目類型，必須從以下列表中選擇：

可選的題目類型：
${questionTypesList}

LaTeX 格式規則（重要！）：
- 所有 LaTeX 命令必須使用雙反斜線（\\\\），例如：\\\\frac{a}{b}、\\\\sqrt{x}、\\\\sum、\\\\int
- 行內公式使用 $...$ 格式，例如：$x^2 + \\\\frac{1}{2}$
- 獨立公式使用 $$...$$ 格式，例如：$$\\\\int_0^1 x^2 dx$$
- 常見命令示例：\\\\sin、\\\\cos、\\\\log、\\\\lim、\\\\alpha、\\\\beta、\\\\times、\\\\div

請確保：
- 準確提取所有文字內容
- 正確識別題號和年份
- question_type_name 必須從上述列表中選擇
- 合理評估難度
- 如果一張圖片包含多個題目，請全部提取
- 所有 LaTeX 命令都必須使用雙反斜線（\\\\）以避免 JSON 解析錯誤`,
            },
            {
              type: 'image',
              image: `data:${mimeType};base64,${base64Image}`,
            },
          ],
        },
      ],
    });
    const tokensUsed = result.usage?.totalTokens || 0;
    console.log(`  ℹ Tokens used: ${tokensUsed}`);
    return result.object as ExtractedQuestions;
  } catch (error) {
    console.error('Error performing OCR:', error);
    throw error;
  }
}

/**
 * Generate embeddings for question content
 */
async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const { embedding } = await embed({
      model: v4api.textEmbeddingModel('text-embedding-3-small'),
      value: text,
    });
    
    return embedding;
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw error;
  }
}

/**
 * Read all image files from the pastpapers folder
 */
async function readImageFiles(folderPath: string): Promise<string[]> {
  try {
    const files = await fs.readdir(folderPath);
    const imageFiles = files.filter(file => 
      file.endsWith('.jpg') || 
      file.endsWith('.jpeg') || 
      file.endsWith('.png')
    );
    
    if (imageFiles.length === 0) {
      console.warn(`No image files found in ${folderPath}`);
      return [];
    }
    
    console.log(`Found ${imageFiles.length} image file(s)`);
    
    return imageFiles.map(file => path.join(folderPath, file));
  } catch (error) {
    console.error(`Error reading pastpapers folder: ${error}`);
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
 * Upload questions to Supabase pastpapers table
 */
async function uploadToSupabase(questions: PastPaperRecord[]): Promise<void> {
  console.log('\nUploading questions to Supabase...');
  
  let successCount = 0;
  let errorCount = 0;
  
  for (const question of questions) {
    try {
      const { data, error } = await supabase
        .from('pastpapers')
        .insert({
          topic: question.topic,
          question: question.question,
          answer: question.answer,
          question_number: question.question_number,
          question_year: question.question_year,
          subject_id: CONFIG.subject_id,
          explanation: question.explanation,
          difficulty: question.difficulty,
          grade_level: question.grade_level,
          question_type_id: question.question_type_id,
          embedding: question.embedding,
          metadata: question.metadata,
        })
        .select();
      
      if (error) {
        throw new Error(`Failed to upload question: ${error.message}`);
      }
      
      console.log(`  ✓ Uploaded Q${question.question_number} (ID: ${data[0].id})`);
      successCount++;
    } catch (error) {
      console.error(`  ✗ Failed to upload Q${question.question_number}:`, error);
      errorCount++;
    }
  }
  
  console.log(`\n✓ Upload complete: ${successCount} succeeded, ${errorCount} failed`);
}

/**
 * Save extracted questions to txt file for review
 */
async function saveToReviewFile(questions: PastPaperRecord[], outputPath: string): Promise<void> {
  let content = '=== EXTRACTED PAST PAPER QUESTIONS ===\n';
  content += `Total Questions: ${questions.length}\n`;
  content += `Generated: ${new Date().toISOString()}\n`;
  content += '=' .repeat(80) + '\n\n';
  
  questions.forEach((q, index) => {
    content += `Question ${index + 1}:\n`;
    content += `  Topic: ${q.topic}\n`;
    content += `  Year: ${q.question_year}\n`;
    content += `  Question Number: ${q.question_number}\n`;
    content += `  Subject: ${q.subject}\n`;
    content += `  Grade Level: ${q.grade_level}\n`;
    content += `  Question Type ID: ${q.question_type_id}\n`;
    content += `  Difficulty: ${q.difficulty}/5\n`;
    content += `  Explanation: ${q.explanation}\n`;
    content += `  Question:${q.question}\n`;
    content += `  Answer:${q.answer}\n`;
    content += `  Metadata: ${JSON.stringify(q.metadata, null, 2)}\n`;
    content += '-'.repeat(80) + '\n\n';
  });
  
  await fs.writeFile(outputPath, content, 'utf-8');
  console.log(`\n✓ Review file saved to: ${outputPath}`);
}

/**
 * Process and extract questions from all images
 */
async function processAndExtractQuestions() {
  console.log('=== Past Paper Uploader (OCR & Classification) ===\n');
  console.log('Configuration:');
  console.log(`  Subject: ${CONFIG.subject}`);
  console.log(`  Grade Level: ${CONFIG.gradeLevel}`);
  console.log(`  Images Folder: ${CONFIG.pastpapersFolder}`);
  console.log(`  Output File: ${CONFIG.outputFile}\n`);
  
  // Step 1: Fetch question types from Supabase
  console.log('Step 1: Fetching question types from Supabase...');
  const questionTypes = await fetchQuestionTypes(CONFIG.subject);
  console.log(`  ✓ Found ${questionTypes.length} question types:`);
  questionTypes.forEach(qt => console.log(`    - ${qt.name}`));
  
  // Step 2: Read all image files
  console.log('\nStep 2: Reading image files...');
  const imageFiles = await readImageFiles(CONFIG.pastpapersFolder);
  
  if (imageFiles.length === 0) {
    console.log('\nNo images to process. Exiting.');
    return;
  }
  
  // Step 3: Process each image
  console.log(`\nStep 3: Processing ${imageFiles.length} image(s) with OCR and AI classification...\n`);
  
  const allRecords: PastPaperRecord[] = [];
  let successCount = 0;
  let errorCount = 0;
  
  for (const imagePath of imageFiles) {
    try {
      const filename = path.basename(imagePath);
      console.log(`Processing: ${filename}`);
      
      // Perform OCR and classification
      console.log('  → Performing OCR and classification...');
      const extractedData = await performOCR(imagePath, questionTypes);
      
      console.log(`  → Extracted ${extractedData.length} question(s)`);
      
      // Process each question
      for (const question of extractedData) {
        try {
          // Map question type name to ID
          const questionTypeId = mapQuestionTypeToId(question.question_type_name, questionTypes);
          
          // Generate embedding
          console.log(`    → Generating embedding for Q${question.question_number}...`);
          const embedding = await generateEmbedding(question.question + '\n' + question.answer + '\n' + question.explanation);
          
          // Create record
          const record: PastPaperRecord = {
            topic: question.question_type_name,
            question: question.question,
            question_number: question.question_number,
            question_year: question.question_year,
            subject: CONFIG.subject,
            explanation: question.explanation,
            answer: question.answer,
            difficulty: question.difficulty,
            grade_level: CONFIG.gradeLevel,
            question_type_id: questionTypeId,
            embedding: embedding,
            metadata: {
              source_image: filename,
              extracted_at: new Date().toISOString(),
              question_type_name: question.question_type_name,
            },
          };
          
          allRecords.push(record);
          console.log(`    ✓ Q${question.question_number} processed successfully`);
        } catch (error) {
          console.error(`    ✗ Error processing question ${question.question_number}:`, error);
          errorCount++;
        }
      }
      
      successCount++;
    } catch (error) {
      console.error(`  ✗ Error processing ${path.basename(imagePath)}:`, error);
      errorCount++;
    }
    
    console.log(''); // Empty line for readability
  }
  
  // Step 4: Save to review file
  if (allRecords.length > 0) {
    console.log('Step 4: Saving extracted questions to review file...');
    await saveToReviewFile(allRecords, CONFIG.outputFile);
    
    // Step 5: Upload to Supabase
    console.log('\nStep 5: Uploading to Supabase...');
    await uploadToSupabase(allRecords);
  }
  
  // Summary
  console.log('\n=== Extraction Summary ===');
  console.log(`Total images processed: ${imageFiles.length}`);
  console.log(`Successful extractions: ${successCount}`);
  console.log(`Failed extractions: ${errorCount}`);
  console.log(`Total questions extracted: ${allRecords.length}`);
  
  if (allRecords.length > 0) {
    console.log('\n✓ Process completed successfully!');
    console.log(`\nReview file saved at:`);
    console.log(`  ${CONFIG.outputFile}`);
  }
}

// Run the script
processAndExtractQuestions()
  .then(() => {
    console.log('\nScript finished.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Script failed:', error);
    process.exit(1);
  });
