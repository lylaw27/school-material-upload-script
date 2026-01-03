import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// ===== CONFIGURATION SECTION =====
const CONFIG = {
  // MCQ Set Information
  setTopic: '師說',
  setDescription: '是日練習集',
  setSubject: 'DSE中文12篇範文',
  
  // Filters for selecting MCQs (set to null to disable a filter)
  filters: {
    topic: '師說' as string | null, // Filter by topic, or null for all topics
    questionTypeNames: null as string[] | null, // e.g., ['文句翻譯與名句摘錄'] or null for all types
    subject: 'DSE中文12篇範文' as string | null, // Filter by subject, or null for all
    
    // Difficulty distribution
    // Option 1: Simple limit by difficulty level
    // difficultyLevels: [3, 4, 5] as number[] | null, // Only select questions with these difficulty levels
    
    // Option 2: Specify exact count for each difficulty level
    // difficultyDistribution: {
    //   easy: 3,      // Number of easy questions (difficulty 1-2)
    //   medium: 4,    // Number of medium questions (difficulty 3)
    //   hard: 3,      // Number of hard questions (difficulty 4-5)
    // } as { easy: number; medium: number; hard: number } | null,

    difficultyDistribution: null as { easy: number; medium: number; hard: number } | null,
    
    // Maximum total questions to select (only used if difficultyDistribution is null)
    limit: 10,
  },
};
// ===== END CONFIGURATION SECTION =====

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Type definitions
interface MCQ {
  id: string;
  topic: string;
  question: string;
  subject: string;
  options: Record<string, string>;
  correct_answer: string;
  explanation: string;
  grade_level: string | null;
  difficulty: number | null;
  question_type_id: string | null;
  source_material_ids: string[] | null;
  embedding: any;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

interface MCQSet {
  id: string;
  topic: string;
  description: string | null;
  subject: string;
  created_at: string;
  updated_at: string;
}

interface QuestionType {
  id: string;
  name: string;
  subject: string;
}

/**
 * Fetch question types from Supabase
 */
async function fetchQuestionTypes(subject: string): Promise<QuestionType[]> {
  const { data, error } = await supabase
    .from('question_types')
    .select('id, name, subject')
    .eq('subject', subject);
  
  if (error) {
    throw new Error(`Failed to fetch question types: ${error.message}`);
  }
  
  return data as QuestionType[];
}

/**
 * Fetch MCQs based on filters
 */
async function fetchMCQs(
  filters: typeof CONFIG.filters,
  questionTypes: QuestionType[]
): Promise<MCQ[]> {
  console.log('\n=== Fetching MCQs ===');
  
  const allMCQs: MCQ[] = [];
  
  // If we have difficulty distribution, fetch questions for each difficulty level
  if (filters.difficultyDistribution) {
    const { easy, medium, hard } = filters.difficultyDistribution;
    
    // Fetch easy questions (difficulty 1-2)
    if (easy > 0) {
      console.log(`Fetching ${easy} easy questions (difficulty 1-2)...`);
      const easyQuestions = await fetchMCQsByDifficulty(filters, questionTypes, [1, 2], easy);
      allMCQs.push(...easyQuestions);
      console.log(`  ✓ Found ${easyQuestions.length} easy questions`);
    }
    
    // Fetch medium questions (difficulty 3)
    if (medium > 0) {
      console.log(`Fetching ${medium} medium questions (difficulty 3)...`);
      const mediumQuestions = await fetchMCQsByDifficulty(filters, questionTypes, [3], medium);
      allMCQs.push(...mediumQuestions);
      console.log(`  ✓ Found ${mediumQuestions.length} medium questions`);
    }
    
    // Fetch hard questions (difficulty 4-5)
    if (hard > 0) {
      console.log(`Fetching ${hard} hard questions (difficulty 4-5)...`);
      const hardQuestions = await fetchMCQsByDifficulty(filters, questionTypes, [4, 5], hard);
      allMCQs.push(...hardQuestions);
      console.log(`  ✓ Found ${hardQuestions.length} hard questions`);
    }
  } else {
    // Fetch with simple limit
    console.log(`Fetching up to ${filters.limit} questions...`);
    const questions = await fetchMCQsByDifficulty(filters, questionTypes, null, filters.limit);
    allMCQs.push(...questions);
    console.log(`  ✓ Found ${questions.length} questions`);
  }
  
  return allMCQs;
}

/**
 * Fetch MCQs by specific difficulty levels
 */
async function fetchMCQsByDifficulty(
  filters: typeof CONFIG.filters,
  questionTypes: QuestionType[],
  difficultyLevels: number[] | null,
  limit: number
): Promise<MCQ[]> {
  let query = supabase
    .from('mcqs')
    .select('*');
  
  // Apply subject filter
  if (filters.subject) {
    query = query.eq('subject', filters.subject);
  }
  
  // Apply topic filter
  if (filters.topic) {
    query = query.eq('topic', filters.topic);
  }
  
  // Apply question type filter
  if (filters.questionTypeNames && filters.questionTypeNames.length > 0) {
    const questionTypeIds = questionTypes
      .filter(qt => filters.questionTypeNames!.includes(qt.name))
      .map(qt => qt.id);
    
    if (questionTypeIds.length > 0) {
      query = query.in('question_type_id', questionTypeIds);
    }
  }
  
  // Apply difficulty filter
  if (difficultyLevels && difficultyLevels.length > 0) {
    query = query.in('difficulty', difficultyLevels);
  }
  
  // Fetch all matching records
  const { data, error } = await query;
  
  if (error) {
    throw new Error(`Failed to fetch MCQs: ${error.message}`);
  }
  
  if (!data || data.length === 0) {
    console.warn(`  ⚠ No MCQs found matching the criteria`);
    return [];
  }
  
  // Randomly sample the requested number of questions
  const shuffled = data.sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, Math.min(limit, data.length));
  
  return selected as MCQ[];
}

/**
 * Create a new MCQ set
 */
async function createMCQSet(
  topic: string,
  description: string | null,
  subject: string
): Promise<MCQSet> {
  console.log('\n=== Creating MCQ Set ===');
  console.log(`Topic: ${topic}`);
  console.log(`Subject: ${subject}`);
  console.log(`Description: ${description || 'N/A'}`);
  
  const { data, error } = await supabase
    .from('mcqsets')
    .insert({
      topic,
      description,
      subject,
    })
    .select()
    .single();
  
  if (error) {
    throw new Error(`Failed to create MCQ set: ${error.message}`);
  }
  
  console.log(`✓ MCQ set created with ID: ${data.id}`);
  
  return data as MCQSet;
}

/**
 * Link MCQs to the MCQ set
 */
async function linkMCQsToSet(
  mcqSetId: string,
  mcqs: MCQ[]
): Promise<void> {
  console.log('\n=== Linking MCQs to Set ===');
  console.log(`MCQ Set ID: ${mcqSetId}`);
  console.log(`Number of MCQs to link: ${mcqs.length}`);
  
  // Sort MCQs by difficulty (easiest first)
  const sortedMCQs = [...mcqs].sort((a, b) => {
    const diffA = a.difficulty || 999; // Put questions without difficulty at the end
    const diffB = b.difficulty || 999;
    return diffA - diffB;
  });
  
  console.log('  Ordering by difficulty (easiest to hardest)');
  
  // Create records for mcqset_questions table
  const mcqSetQuestions = sortedMCQs.map((mcq, index) => ({
    mcqset_id: mcqSetId,
    mcq_id: mcq.id,
    order_index: index + 1,
  }));
  
  const { error } = await supabase
    .from('mcqset_questions')
    .insert(mcqSetQuestions);
  
  if (error) {
    throw new Error(`Failed to link MCQs to set: ${error.message}`);
  }
  
  console.log(`✓ Successfully linked ${mcqs.length} MCQs to the set (ordered by difficulty)`);
}

/**
 * Display summary of selected MCQs
 */
function displayMCQSummary(mcqs: MCQ[]): void {
  console.log('\n=== Selected MCQs Summary ===');
  console.log(`Total MCQs: ${mcqs.length}`);
  
  // Group by topic
  const topicCounts = mcqs.reduce((acc, mcq) => {
    acc[mcq.topic] = (acc[mcq.topic] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  console.log('\nBy Topic:');
  Object.entries(topicCounts).forEach(([topic, count]) => {
    console.log(`  ${topic}: ${count}`);
  });
  
  // Group by difficulty
  const difficultyCounts = mcqs.reduce((acc, mcq) => {
    const difficulty = mcq.difficulty || 0;
    acc[difficulty] = (acc[difficulty] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);
  
  console.log('\nBy Difficulty:');
  Object.entries(difficultyCounts)
    .sort(([a], [b]) => Number(a) - Number(b))
    .forEach(([difficulty, count]) => {
      const label = Number(difficulty) <= 2 ? 'Easy' :
                    Number(difficulty) === 3 ? 'Medium' : 'Hard';
      console.log(`  Level ${difficulty} (${label}): ${count}`);
    });
  
  console.log('\nSample Questions:');
  mcqs.slice(0, 3).forEach((mcq, idx) => {
    console.log(`\n${idx + 1}. ${mcq.question.substring(0, 80)}...`);
    console.log(`   Difficulty: ${mcq.difficulty}/5 | Topic: ${mcq.topic}`);
  });
}

/**
 * Main function
 */
async function main() {
  console.log('=== MCQ Set Creator ===\n');
  console.log('Configuration:');
  console.log(`  Set Topic: ${CONFIG.setTopic}`);
  console.log(`  Set Subject: ${CONFIG.setSubject}`);
  console.log(`  Set Description: ${CONFIG.setDescription || 'N/A'}`);
  console.log('\nFilters:');
  console.log(`  Topic Filter: ${CONFIG.filters.topic || 'All topics'}`);
  console.log(`  Subject Filter: ${CONFIG.filters.subject || 'All subjects'}`);
  console.log(`  Question Types: ${CONFIG.filters.questionTypeNames?.join(', ') || 'All types'}`);
  
  if (CONFIG.filters.difficultyDistribution) {
    console.log(`  Difficulty Distribution:`);
    console.log(`    Easy (1-2): ${CONFIG.filters.difficultyDistribution.easy}`);
    console.log(`    Medium (3): ${CONFIG.filters.difficultyDistribution.medium}`);
    console.log(`    Hard (4-5): ${CONFIG.filters.difficultyDistribution.hard}`);
  } else {
    console.log(`  Limit: ${CONFIG.filters.limit}`);
  }
  
  try {
    // Step 1: Fetch question types if needed
    let questionTypes: QuestionType[] = [];
    if (CONFIG.filters.questionTypeNames || CONFIG.filters.subject) {
      console.log('\nStep 1: Fetching question types...');
      questionTypes = await fetchQuestionTypes(CONFIG.setSubject);
      console.log(`  ✓ Found ${questionTypes.length} question types`);
    }
    
    // Step 2: Fetch MCQs based on filters
    console.log('\nStep 2: Fetching MCQs from database...');
    const selectedMCQs = await fetchMCQs(CONFIG.filters, questionTypes);
    
    if (selectedMCQs.length === 0) {
      throw new Error('No MCQs found matching the criteria');
    }
    
    // Step 3: Display summary
    displayMCQSummary(selectedMCQs);
    
    // Step 4: Create MCQ set
    const mcqSet = await createMCQSet(
      CONFIG.setTopic,
      CONFIG.setDescription,
      CONFIG.setSubject
    );
    
    // Step 5: Link MCQs to the set
    await linkMCQsToSet(mcqSet.id, selectedMCQs);
    
    // Final summary
    console.log('\n=== Success ===');
    console.log(`MCQ Set ID: ${mcqSet.id}`);
    console.log(`Total MCQs in set: ${selectedMCQs.length}`);
    console.log(`Topic: ${mcqSet.topic}`);
    console.log(`Subject: ${mcqSet.subject}`);
    console.log('\n✓ MCQ set created successfully!');
    
  } catch (error) {
    console.error('\n✗ Error:', error);
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
