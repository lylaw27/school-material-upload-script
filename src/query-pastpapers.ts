import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ===== CONFIGURATION SECTION =====
const CONFIG = {
  // Subject IDs reference:
  // '498833c4-dc12-4a05-b5fc-f7df9f2bd848' - DSE中文12篇範文
  // '577fbad7-c034-4bf4-9645-c24c6ae2e404' - 中國歷史
  // '3abdaa98-1821-428d-b5b8-c908f8d68fd5' - BAFS
  // 'f328d2ae-0d34-4c6e-8866-1ce9fcd5d656' - Chemistry
  // 'b1819b8e-cc76-41ac-9e01-7764faf36d89' - Mathematics
  
  subject_id: 'b1819b8e-cc76-41ac-9e01-7764faf36d89', // Mathematics
  searchText: 'D.', // Text to search in question field
  
  // Output file for results
  outputFile: path.join(__dirname, '..', 'pastpapers', 'query-results.txt'),
};
// ===== END CONFIGURATION SECTION =====

interface PastPaperQuestion {
  id: string;
  topic: string;
  question: string;
  answer: string;
  question_number: number;
  question_year: number;
  explanation: string;
  difficulty: number;
  grade_level: string;
  question_type_id: string;
  subject_id: string;
  metadata: any;
  created_at: string;
  updated_at: string;
}

/**
 * Query past papers from Supabase with filters
 */
async function queryPastPapers(): Promise<PastPaperQuestion[]> {
  console.log('Querying past papers from Supabase...');
  console.log(`  Subject ID: ${CONFIG.subject_id}`);
  console.log(`  Search Text: "${CONFIG.searchText}"`);
  
  const { data, error } = await supabase
    .from('pastpapers')
    .select('*')
    .eq('subject_id', CONFIG.subject_id)
    // .not('question', 'ilike', `%${CONFIG.searchText}%`)
    .order('question_year', { ascending: false })
    .order('question_number', { ascending: true });
  
  if (error) {
    throw new Error(`Failed to query past papers: ${error.message}`);
  }
  
  console.log(`  ✓ Found ${data.length} matching question(s)\n`);
  
  return data as PastPaperQuestion[];
}

/**
 * Display results in console
 */
function displayResults(questions: PastPaperQuestion[]): void {
  console.log('=== Query Results ===\n');
  
  if (questions.length === 0) {
    console.log('No questions found matching the criteria.');
    return;
  }
  
  questions.forEach((q, index) => {
    console.log(`${index + 1}. Question ${q.question_number} (Year: ${q.question_year})`);
    console.log(`   ID: ${q.id}`);
    console.log(`   Topic: ${q.topic}`);
    console.log(`   Difficulty: ${q.difficulty}/5`);
    console.log(`   Question: ${q.question.substring(0, 100)}${q.question.length > 100 ? '...' : ''}`);
    console.log(`   Answer: ${q.answer.substring(0, 100)}${q.answer.length > 100 ? '...' : ''}`);
    console.log('');
  });
}

/**
 * Save results to a file
 */
async function saveResults(questions: PastPaperQuestion[], outputPath: string): Promise<void> {
  let content = '=== PAST PAPER QUERY RESULTS ===\n';
  content += `Query Date: ${new Date().toISOString()}\n`;
  content += `Subject ID: ${CONFIG.subject_id}\n`;
  content += `Search Text: "${CONFIG.searchText}"\n`;
  content += `Total Results: ${questions.length}\n`;
  content += '='.repeat(80) + '\n\n';
  
  if (questions.length === 0) {
    content += 'No questions found matching the criteria.\n';
  } else {
    questions.forEach((q, index) => {
      content += `Question ${index + 1}:\n`;
      content += `  ID: ${q.id}\n`;
      content += `  Year: ${q.question_year}\n`;
      content += `  Question Number: ${q.question_number}\n`;
      content += `  Topic: ${q.topic}\n`;
      content += `  Grade Level: ${q.grade_level}\n`;
      content += `  Difficulty: ${q.difficulty}/5\n`;
      content += `  Question Type ID: ${q.question_type_id}\n`;
      content += `  Created At: ${q.created_at}\n`;
      content += `  Question:\n${q.question}\n\n`;
      content += `  Answer:\n${q.answer}\n\n`;
      content += `  Explanation:\n${q.explanation}\n\n`;
      content += `  Metadata: ${JSON.stringify(q.metadata, null, 2)}\n`;
      content += '-'.repeat(80) + '\n\n';
    });
  }
  
  await fs.writeFile(outputPath, content, 'utf-8');
  console.log(`✓ Results saved to: ${outputPath}`);
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('=== Past Paper Query Tool ===\n');
    
    // Query past papers
    const questions = await queryPastPapers();
    
    // Display results
    displayResults(questions);
    
    // Save to file
    await saveResults(questions, CONFIG.outputFile);
    
    console.log('\n✓ Query completed successfully!');
  } catch (error) {
    console.error('✗ Error:', error);
    throw error;
  }
}

// Run the script
main()
  .then(() => {
    console.log('\nScript finished.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Script failed:', error);
    process.exit(1);
  });
