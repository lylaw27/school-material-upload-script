import { createClient } from '@supabase/supabase-js';
import { openai } from '@ai-sdk/openai';
import { embed, generateText } from 'ai';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

// Load environment variables
dotenv.config();

const v4api = createOpenAICompatible({
  name: 'v4api',
  apiKey: process.env.OPENAI_API_KEY!,
  baseURL: "https://api.gpt.ge/v1"
});

export { v4api };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== CONFIGURATION SECTION =====
// Modify these variables according to your textbook materials
const CONFIG = {
  // Textbook metadata - customize for your materials
  // topic will be extracted from filename (e.g., "algebra-chapter1.txt" -> "algebra-chapter1")
  subject: 'DSE中文12篇範文',
  gradeLevel: 'DSE',
  
  // Folder containing .txt files
  textbooksFolder: process.env.TEXTBOOKS_FOLDER || path.join(__dirname, '..', 'textbooks'),
  
  // Additional metadata (optional)
  metadata: {
    // author: '蘇洵',
    // language: 'Chinese',
  },
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

interface TextbookRecord {
  topic: string;
  content: string;
  subject: string;
  grade_level: string | null;
  embedding: number[];
  metadata: Record<string, any>;
}

/**
 * Summarize content using OpenAI API
 */
async function summarizeContent(content: string): Promise<string> {
  try {
    const { text } = await generateText({
      model: v4api('qwen3-vl-plus'),
      prompt: `以下是其中一篇HKDSE十二篇範文的內容，現在我希望將內容進行整合和縮短，以便嵌入到數據庫中。:\n\n${content}`,
      // maxTokens: 1000,
    });
    
    return text;
  } catch (error) {
    console.error('Error summarizing content:', error);
    throw error;
  }
}

/**
 * Generate embeddings using OpenAI's text-embedding-3-large model (1024 dimensions)
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
 * Extract topic from filename (remove .txt extension)
 */
function extractTopicFromFilename(filename: string): string {
  return path.basename(filename, '.txt');
}

/**
 * Read all .txt files from the textbooks folder
 */
async function readTextbookFiles(folderPath: string): Promise<Map<string, string>> {
  const textbooks = new Map<string, string>();
  
  try {
    const files = await fs.readdir(folderPath);
    const txtFiles = files.filter(file => file.endsWith('.txt'));
    
    if (txtFiles.length === 0) {
      console.warn(`No .txt files found in ${folderPath}`);
      return textbooks;
    }
    
    console.log(`Found ${txtFiles.length} textbook file(s)`);
    
    for (const file of txtFiles) {
      const filePath = path.join(folderPath, file);
      const content = await fs.readFile(filePath, 'utf-8');
      textbooks.set(file, content);
      console.log(`  ✓ Read: ${file} (${content.length} characters)`);
    }
    
    return textbooks;
  } catch (error) {
    console.error(`Error reading textbooks folder: ${error}`);
    throw error;
  }
}

/**
 * Upload a single textbook record to Supabase
 */
async function uploadTextbook(record: TextbookRecord): Promise<void> {
  const { data, error } = await supabase
    .from('textbooks')
    .insert({
      topic: record.topic,
      content: record.content,
      subject: record.subject,
      grade_level: record.grade_level,
      embedding: record.embedding,
      metadata: record.metadata,
    })
    .select();
  
  if (error) {
    throw new Error(`Failed to upload textbook: ${error.message}`);
  }
  
  console.log(`  ✓ Uploaded successfully (ID: ${data[0].id})`);
}

/**
 * Process and upload all textbook materials
 */
async function processAndUploadTextbooks() {
  console.log('=== Textbook Uploader ===\n');
  console.log('Configuration:');
  console.log(`  Subject: ${CONFIG.subject}`);
  console.log(`  Grade Level: ${CONFIG.gradeLevel}`);
  console.log(`  Folder: ${CONFIG.textbooksFolder}\n`);
  
  // Step 1: Read all textbook files
  console.log('Step 1: Reading textbook files...');
  const textbooks = await readTextbookFiles(CONFIG.textbooksFolder);
  
  if (textbooks.size === 0) {
    console.log('\nNo textbooks to upload. Exiting.');
    return;
  }
  
  console.log(`\nStep 2: Processing and uploading ${textbooks.size} textbook(s)...\n`);
  
  let successCount = 0;
  let errorCount = 0;
  
  // Step 2: Process each textbook
  for (const [filename, content] of textbooks.entries()) {
    try {
      console.log(`Processing: ${filename}`);
      
      // Extract topic from filename
      const topic = extractTopicFromFilename(filename);
      console.log(`  → Topic: ${topic}`);
      
      // Summarize content
      console.log('  → Summarizing content with OpenAI...');
      const summary = await summarizeContent(content);
      console.log(`  → Summary generated (${summary.length} characters)`);
      
      // Generate embedding from summary
      console.log('  → Generating embedding from summary...');
      const embedding = await generateEmbedding(summary);
      
      // Prepare record
      const record: TextbookRecord = {
        topic: topic,
        content: content,
        subject: CONFIG.subject,
        grade_level: CONFIG.gradeLevel || null,
        embedding: embedding,
        metadata: {
          ...CONFIG.metadata,
          filename: filename,
          summary: summary,
          uploadedAt: new Date().toISOString(),
        },
      };
      
      // Upload to Supabase
      console.log('  → Uploading to Supabase...');
      await uploadTextbook(record);
      
      successCount++;
    } catch (error) {
      console.error(`  ✗ Error processing ${filename}:`, error);
      errorCount++;
    }
    
    console.log(''); // Empty line for readability
  }
  
  // Summary
  console.log('=== Upload Summary ===');
  console.log(`Total files: ${textbooks.size}`);
  console.log(`Successful uploads: ${successCount}`);
  console.log(`Failed uploads: ${errorCount}`);
  
  if (successCount > 0) {
    console.log('\n✓ Upload completed successfully!');
  }
}

// Run the script
processAndUploadTextbooks()
  .then(() => {
    console.log('\nScript finished.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Script failed:', error);
    process.exit(1);
  });
