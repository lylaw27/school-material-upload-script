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

const subject_id = 'b1819b8e-cc76-41ac-9e01-7764faf36d89';

// ===== CONFIGURATION SECTION =====
// Modify this configuration to upload your question types
const CONFIG = {
  // Subject IDs reference:
  // '498833c4-dc12-4a05-b5fc-f7df9f2bd848' - DSE中文12篇範文
  // '577fbad7-c034-4bf4-9645-c24c6ae2e404' - 中國歷史
  // '3abdaa98-1821-428d-b5b8-c908f8d68fd5' - BAFS
  // 'f328d2ae-0d34-4c6e-8866-1ce9fcd5d656' - Chemistry
  // 'b1819b8e-cc76-41ac-9e01-7764faf36d89' - Mathematics
  
  questionTypes: [
    {
      name: '估算與誤差',
      eng_name: 'Estimation and Error',
      subject_id: subject_id
    },
    {
      name: '公式與恆等式',
      eng_name: 'Formulas and Identities',
      subject_id: subject_id
    },
    {
      name: '指數與對數',
      eng_name: 'Exponents and Logarithms',
      subject_id: subject_id
    },
    {
      name: '多項式',
      eng_name: 'Polynomials',
      subject_id: subject_id
    },
    {
      name: '方程',
      eng_name: 'Equations',
      subject_id: subject_id
    },
        {
      name: '函數與圖像',
      eng_name: 'Functions and Graphs',
      subject_id: subject_id
    },

        {
      name: '變分',
      eng_name: 'Variations',
      subject_id: subject_id
    },
        {
      name: '等差與等比數列',
      eng_name: 'Arithmetic and Geometric Sequences',
      subject_id: subject_id
    },
        {
      name: '不等式',
      eng_name: 'Inequalities',
      subject_id: subject_id
    },
        {
      name: '平面幾何',
      eng_name: 'Plane Geometry',
      subject_id: subject_id
    },
        {
      name: '立體幾何',
      eng_name: '3D Geometry',
      subject_id: subject_id
    },
        {
      name: '三角學',
      eng_name: 'Trigonometry',
      subject_id: subject_id
    },
        {
      name: '坐標幾何',
      eng_name: 'Coordinates',
      subject_id: subject_id
    },
        {
      name: '軌跡',
      eng_name: 'Locus',
      subject_id: subject_id
    },
        {
      name: '排列與組合',
      eng_name: 'Permutations and Combinations',
      subject_id: subject_id
    },
        {
      name: '概率',
      eng_name: 'Probability',
      subject_id: subject_id
    },
        {
      name: '統計學',
      eng_name: 'Statistics',
      subject_id: subject_id
    },
    // Add more question types here as needed
  ]
};
// ===== END CONFIGURATION SECTION =====

async function uploadQuestionTypes() {
  console.log('Starting question type upload...\n');

  for (const questionType of CONFIG.questionTypes) {
    try {
      console.log(`Uploading: ${questionType.name}...`);
      
      const { data, error } = await supabase
        .from('question_types')
        .insert({
          name: questionType.name,
          eng_name: questionType.eng_name,
          subject_id: questionType.subject_id
        })
        .select();

      if (error) {
        console.error(`❌ Error uploading "${questionType.name}":`, error.message);
      } else {
        console.log(`✅ Successfully uploaded: ${questionType.name}`);
        console.log(`   ID: ${data[0].id}\n`);
      }
    } catch (err) {
      console.error(`❌ Exception uploading "${questionType.name}":`, err);
    }
  }

  console.log('Upload completed!');
}

// Run the script
uploadQuestionTypes().catch(console.error);
