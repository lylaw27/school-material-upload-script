# School Material Uploader

A TypeScript script to upload textbook materials to Supabase with AI-generated embeddings.

## Features

- 📚 Reads textbook materials from `.txt` files
- 🤖 Generates 1024-dimensional embeddings using OpenAI's text-embedding-3-large model
- 🗄️ Uploads to Supabase with configurable metadata
- ⚙️ Easy configuration for topic, subject, and grade level

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   
   Copy `.env.example` to `.env` and fill in your credentials:
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` with your actual values:
   ```env
   SUPABASE_URL=your_supabase_project_url
   SUPABASE_ANON_KEY=your_supabase_anon_key
   OPENAI_API_KEY=your_openai_api_key
   TEXTBOOKS_FOLDER=./textbooks
   ```

3. **Prepare your textbook materials:**
   
   Place your `.txt` files in the `textbooks` folder (or the folder specified in `.env`)

## Configuration

Edit the `CONFIG` section in `src/upload.ts` to customize the metadata for your textbooks:

```typescript
const CONFIG = {
  topic: 'Introduction to Algebra',      // Customize for your materials
  subject: 'Mathematics',                // e.g., Math, Science, History
  gradeLevel: 'Grade 9',                 // e.g., Grade 8, High School
  
  textbooksFolder: './textbooks',        // Path to your .txt files
  
  metadata: {
    author: 'School District',
    language: 'English',
    year: 2024,
  },
};
```

## Usage

Run the upload script:

```bash
npm run upload
```

The script will:
1. Read all `.txt` files from the textbooks folder
2. Generate embeddings for each file
3. Upload to Supabase with the configured metadata

## Database Schema

The script expects the following Supabase table structure:

```sql
CREATE TABLE textbooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic TEXT NOT NULL,
    content TEXT NOT NULL,
    subject TEXT NOT NULL,
    grade_level TEXT,
    embedding vector(1024),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Example Output

```
=== Textbook Uploader ===

Configuration:
  Topic: Introduction to Algebra
  Subject: Mathematics
  Grade Level: Grade 9
  Folder: ./textbooks

Step 1: Reading textbook files...
Found 2 textbook file(s)
  ✓ Read: algebra-chapter1.txt (1245 characters)
  ✓ Read: algebra-chapter2.txt (892 characters)

Step 2: Processing and uploading 2 textbook(s)...

Processing: algebra-chapter1.txt
  → Generating embedding...
  → Uploading to Supabase...
  ✓ Uploaded successfully (ID: 123e4567-e89b-12d3-a456-426614174000)

Processing: algebra-chapter2.txt
  → Generating embedding...
  → Uploading to Supabase...
  ✓ Uploaded successfully (ID: 123e4567-e89b-12d3-a456-426614174001)

=== Upload Summary ===
Total files: 2
Successful uploads: 2
Failed uploads: 0

✓ Upload completed successfully!
```

## Notes

- The script uses OpenAI's `text-embedding-3-large` model with 1024 dimensions to match your database schema
- Each `.txt` file is treated as a separate textbook entry
- File names are automatically included in the metadata
- The script will skip the upload if no `.txt` files are found
- Errors are logged but won't stop the processing of other files

## License

MIT
