import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ===== CONFIGURATION SECTION =====
const CONFIG = {
  // List of source_image values to delete
  // Example: ['2023p2 Page 010.jpg','2022p2 Page 013.jpg','2021p2 (1) Page 002.jpg,'2021p2 (1) Page 008.jpg','2020p2 Page 005.jpg','2020p2 Page 006.jpg','2019p2 Page 003.jpg']
  sourceImagesToDelete: ['2023p2 Page 010.jpg','2022p2 Page 013.jpg','2021p2 (1) Page 002.jpg','2021p2 (1) Page 008.jpg','2020p2 Page 005.jpg','2020p2 Page 006.jpg','2019p2 Page 003.jpg'],
  subject_id: 'b1819b8e-cc76-41ac-9e01-7764faf36d89', // Mathematics
  
  // Set to true to actually delete, false for dry run (preview only)
  confirmDelete: true,
};
// ===== END CONFIGURATION SECTION =====

interface PastPaperQuestion {
  id: string;
  topic: string;
  question_number: number;
  question_year: number;
  metadata: {
    source_image?: string;
    [key: string]: any;
  };
}

/**
 * Query past papers by source_image metadata
 */
async function findPastPapersBySourceImage(sourceImages: string[]): Promise<PastPaperQuestion[]> {
  console.log('Searching for past papers with source images:', sourceImages);
  
  const allMatches: PastPaperQuestion[] = [];
  
  // Query for each source image
  for (const sourceImage of sourceImages) {
    const { data, error } = await supabase
      .from('pastpapers')
      .select('id, topic, question_number, question_year, metadata')
      .eq('subject_id', CONFIG.subject_id)
      .contains('metadata', { source_image: sourceImage });
    
    if (error) {
      console.error(`  ✗ Error querying for ${sourceImage}:`, error.message);
      continue;
    }
    
    if (data && data.length > 0) {
      console.log(`  ✓ Found ${data.length} question(s) from ${sourceImage}`);
      allMatches.push(...(data as PastPaperQuestion[]));
    } else {
      console.log(`  ℹ No questions found for ${sourceImage}`);
    }
  }
  
  return allMatches;
}

/**
 * Delete past papers by IDs
 */
async function deletePastPapers(questionIds: string[]): Promise<void> {
  console.log(`\nDeleting ${questionIds.length} question(s)...`);
  
  let successCount = 0;
  let errorCount = 0;
  
  for (const id of questionIds) {
    try {
      const { error } = await supabase
        .from('pastpapers')
        .delete()
        .eq('id', id);
      
      if (error) {
        throw new Error(`Failed to delete: ${error.message}`);
      }
      
      console.log(`  ✓ Deleted question ID: ${id}`);
      successCount++;
    } catch (error) {
      console.error(`  ✗ Failed to delete ID ${id}:`, error);
      errorCount++;
    }
  }
  
  console.log(`\n✓ Delete complete: ${successCount} succeeded, ${errorCount} failed`);
}

/**
 * Display questions to be deleted
 */
function displayQuestions(questions: PastPaperQuestion[]): void {
  console.log('\n=== Questions to be Deleted ===\n');
  
  if (questions.length === 0) {
    console.log('No questions found matching the criteria.');
    return;
  }
  
  questions.forEach((q, index) => {
    console.log(`${index + 1}. Question ${q.question_number} (Year: ${q.question_year})`);
    console.log(`   ID: ${q.id}`);
    console.log(`   Topic: ${q.topic}`);
    console.log(`   Source Image: ${q.metadata.source_image || 'N/A'}`);
    console.log('');
  });
  
  console.log(`Total: ${questions.length} question(s)\n`);
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('=== Past Paper Deletion Tool ===\n');
    
    if (CONFIG.sourceImagesToDelete.length === 0) {
      console.log('⚠ No source images specified in CONFIG.sourceImagesToDelete');
      console.log('Please edit the CONFIG section and add image filenames to delete.');
      return;
    }
    
    // Step 1: Find matching questions
    console.log('Step 1: Finding questions to delete...\n');
    const questions = await findPastPapersBySourceImage(CONFIG.sourceImagesToDelete);
    
    if (questions.length === 0) {
      console.log('\n✓ No matching questions found. Nothing to delete.');
      return;
    }
    
    // Step 2: Display questions
    displayQuestions(questions);
    
    // Step 3: Delete or dry run
    if (CONFIG.confirmDelete) {
      console.log('⚠ CONFIRM DELETE is TRUE - Proceeding with deletion...\n');
      const questionIds = questions.map(q => q.id);
      await deletePastPapers(questionIds);
      console.log('\n✓ Deletion completed!');
    } else {
      console.log('ℹ DRY RUN MODE - No questions were deleted.');
      console.log('To actually delete these questions, set CONFIG.confirmDelete = true');
    }
    
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
