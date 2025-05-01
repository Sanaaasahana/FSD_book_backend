import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import env from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Initialize Express
const app = express();
const port = process.env.PORT || 3000;
env.config();

// Configure paths for EJS
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Database configuration
const dbConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { 
    rejectUnauthorized: false 
  } : false
};

const db = new pg.Client(dbConfig);

// Database connection and setup
async function connectToDatabase() {
  try {
    await db.connect();
    console.log("Connected to PostgreSQL database");
    
    // Create tables if they don't exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE
      );
    `);
    
    await db.query(`
      CREATE TABLE IF NOT EXISTS books (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        isbn VARCHAR(17) UNIQUE NOT NULL,
        description TEXT,
        rating NUMERIC(3,1) CHECK (rating >= 0 AND rating <= 5),
        category_id INTEGER REFERENCES categories(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    console.log("Verified database tables");
  } catch (err) {
    console.error("Database connection error:", err);
    process.exit(1);
  }
}

// Connect to database
connectToDatabase();

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { message: 'Something went wrong!' });
});

// Routes
app.get("/", async (req, res, next) => {
  try {
    const searchTerm = req.query.search || '';
    let booksQuery = `
      SELECT b.*, c.name as category_name 
      FROM books b
      LEFT JOIN categories c ON b.category_id = c.id
    `;
    
    if (searchTerm) {
      booksQuery += ` WHERE b.title ILIKE $1 OR c.name ILIKE $1`;
      booksQuery += ` ORDER BY b.title ASC`;
      const booksResult = await db.query(booksQuery, [`%${searchTerm}%`]);
      const categoriesResult = await db.query("SELECT * FROM categories ORDER BY name ASC");
      
      return res.render("index", {
        bookItems: booksResult.rows,
        categories: categoriesResult.rows,
        searchTerm
      });
    }
    
    booksQuery += ` ORDER BY b.created_at DESC`;
    const booksResult = await db.query(booksQuery);
    const categoriesResult = await db.query("SELECT * FROM categories ORDER BY name ASC");
    
    res.render("index", {
      bookItems: booksResult.rows,
      categories: categoriesResult.rows,
      searchTerm
    });
  } catch (err) {
    next(err);
  }
});

app.post("/add", async (req, res, next) => {
  const { title, isbn, description, rating, category, newCategory } = req.body;

  // Validation
  if (!title?.trim()) return res.status(400).send("Title is required");
  if (!isbn || !/^\d{10}(\d{3})?$/.test(isbn)) {
    return res.status(400).send("Valid ISBN (10 or 13 digits) required");
  }
  
  const parsedRating = parseFloat(rating);
  if (isNaN(parsedRating) || parsedRating < 0 || parsedRating > 5) {
    return res.status(400).send("Rating must be 0-5");
  }

  try {
    let categoryId = category;
    
    if (newCategory?.trim()) {
      const catResult = await db.query(
        "INSERT INTO categories(name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id", 
        [newCategory.trim()]
      );
      categoryId = catResult.rows[0].id;
    }

    await db.query(
      `INSERT INTO books(title, isbn, description, rating, category_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [title.trim(), isbn, description?.trim(), parsedRating, categoryId]
    );
    
    res.redirect("/");
  } catch (err) {
    if (err.code === '23505') {
      res.status(400).send("Book with this ISBN already exists");
    } else {
      next(err);
    }
  }
});

app.post("/add-category", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false });
    
    const result = await db.query(
      "INSERT INTO categories(name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING id", 
      [name.trim()]
    );
    
    if (result.rows.length === 0) {
      return res.json({ success: true, exists: true });
    }
    
    res.json({ 
      success: true, 
      category: { id: result.rows[0].id, name: name.trim() } 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

app.get("/edit", async (req, res, next) => {
  try {
    const { isbn } = req.query;
    if (!isbn) return res.status(400).send("ISBN required");
    
    const bookResult = await db.query(`
      SELECT b.*, c.name as category_name 
      FROM books b LEFT JOIN categories c ON b.category_id = c.id 
      WHERE b.isbn = $1
    `, [isbn]);
    
    if (bookResult.rows.length === 0) {
      return res.status(404).send("Book not found");
    }
    
    const categories = await db.query("SELECT * FROM categories ORDER BY name ASC");
    res.render("edit", {
      book: bookResult.rows[0],
      categories: categories.rows
    });
  } catch (err) {
    next(err);
  }
});

app.post("/update", async (req, res, next) => {
  const { originalIsbn, title, isbn, description, rating, category } = req.body;

  // Validation
  if (!title?.trim()) return res.status(400).send("Title is required");
  if (!isbn || !/^\d{10}(\d{3})?$/.test(isbn)) {
    return res.status(400).send("Valid ISBN (10 or 13 digits) required");
  }
  
  const parsedRating = parseFloat(rating);
  if (isNaN(parsedRating) || parsedRating < 0 || parsedRating > 5) {
    return res.status(400).send("Rating must be 0-5");
  }

  try {
    await db.query(
      `UPDATE books 
       SET title = $1, isbn = $2, description = $3, 
           rating = $4, category_id = $5 
       WHERE isbn = $6`,
      [
        title.trim(),
        isbn,
        description?.trim(),
        parsedRating,
        category,
        originalIsbn
      ]
    );
    
    res.redirect("/");
  } catch (err) {
    if (err.code === '23505') {
      res.status(400).send("Book with this ISBN already exists");
    } else {
      next(err);
    }
  }
});

app.post("/delete", async (req, res, next) => {
  try {
    const { isbn } = req.body;
    if (!isbn) return res.status(400).send("ISBN required");
    
    const result = await db.query(
      "DELETE FROM books WHERE isbn = $1 RETURNING *",
      [isbn]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).send("Book not found");
    }
    
    res.redirect("/");
  } catch (err) {
    next(err);
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

process.on('SIGTERM', () => {
  db.end().then(() => process.exit(0));
});
