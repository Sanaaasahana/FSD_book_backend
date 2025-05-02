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
        description TEXT,
        rating NUMERIC(3,1) CHECK (rating >= 0 AND rating <= 5),
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
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

// Routes
app.get("/", async (req, res) => {
  try {
    const sortBy = req.query.sort || 'title-asc';
    let orderBy = '';
    
    switch(sortBy) {
      case 'title-asc':
        orderBy = 'b.title ASC';
        break;
      case 'title-desc':
        orderBy = 'b.title DESC';
        break;
      case 'rating-asc':
        orderBy = 'b.rating ASC NULLS LAST';
        break;
      case 'rating-desc':
        orderBy = 'b.rating DESC NULLS LAST';
        break;
      case 'category-asc':
        orderBy = 'c.name ASC NULLS LAST';
        break;
      default:
        orderBy = 'b.id DESC';
    }

    const books = await db.query(`
      SELECT b.*, c.name as category_name 
      FROM books b
      LEFT JOIN categories c ON b.category_id = c.id
      ORDER BY ${orderBy}
    `);
    
    const categories = await db.query("SELECT * FROM categories ORDER BY name ASC");
    
    res.render("index", {
      books: books.rows,
      categories: categories.rows,
      sortBy
    });
  } catch (err) {
    console.error("Home route error:", err);
    res.status(500).render("error", { error: "Error loading books" });
  }
});

app.post("/add", async (req, res) => {
  try {
    const { newTitle, newDescription, newRating, category, newCategory } = req.body;

    // Validate inputs
    if (!newTitle?.trim()) throw new Error("Title is required");
    
    const numRating = newRating ? parseFloat(newRating) : null;
    if (numRating && (isNaN(numRating) || numRating < 0 || numRating > 5)) {
      throw new Error("Rating must be between 0 and 5");
    }

    let finalCategoryId = category || null;
    
    // Handle new category if provided
    if (newCategory?.trim()) {
      const result = await db.query(
        "INSERT INTO categories(name) VALUES ($1) RETURNING id",
        [newCategory.trim()]
      );
      finalCategoryId = result.rows[0].id;
    }

    await db.query(
      `INSERT INTO books(title, description, rating, category_id)
       VALUES ($1, $2, $3, $4)`,
      [newTitle.trim(), newDescription?.trim(), numRating, finalCategoryId]
    );
    
    res.redirect("/");
  } catch (err) {
    console.error("Add book error:", err);
    res.status(400).render("error", { error: err.message });
  }
});

app.get("/edit", async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) throw new Error("Book ID required");

    const book = await db.query(`
      SELECT b.*, c.name as category_name 
      FROM books b 
      LEFT JOIN categories c ON b.category_id = c.id 
      WHERE b.id = $1
    `, [id]);
    
    if (book.rows.length === 0) throw new Error("Book not found");

    const categories = await db.query("SELECT * FROM categories ORDER BY name ASC");
    
    res.render("edit", {
      bookToEdit: book.rows[0],
      categories: categories.rows
    });
  } catch (err) {
    console.error("Edit book error:", err);
    res.status(400).render("error", { error: err.message });
  }
});

app.post("/update", async (req, res) => {
  try {
    const { id, updatedTitle, updatedDescription, updatedRating, updatedCategory } = req.body;

    // Validate inputs
    if (!id) throw new Error("Book ID required");
    if (!updatedTitle?.trim()) throw new Error("Title is required");
    
    const numRating = updatedRating ? parseFloat(updatedRating) : null;
    if (numRating && (isNaN(numRating) || numRating < 0 || numRating > 5)) {
      throw new Error("Rating must be between 0 and 5");
    }

    await db.query(
      `UPDATE books 
       SET title = $1, description = $2, 
           rating = $3, category_id = $4 
       WHERE id = $5`,
      [
        updatedTitle.trim(), 
        updatedDescription?.trim(), 
        numRating, 
        updatedCategory || null, 
        id
      ]
    );
    
    res.redirect("/");
  } catch (err) {
    console.error("Update book error:", err);
    res.status(400).render("error", { 
      error: err.message,
      bookToEdit: req.body,
      categories: await db.query("SELECT * FROM categories ORDER BY name ASC")
    });
  }
});

app.post("/delete", async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) throw new Error("Book ID required");
    
    const result = await db.query(
      "DELETE FROM books WHERE id = $1 RETURNING *",
      [id]
    );
    
    if (result.rowCount === 0) throw new Error("Book not found");
    
    res.redirect("/");
  } catch (err) {
    console.error("Delete book error:", err);
    res.status(400).render("error", { error: err.message });
  }
});

app.post("/add-category", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) throw new Error("Category name required");
    
    const result = await db.query(
      "INSERT INTO categories(name) VALUES ($1) RETURNING id, name",
      [name.trim()]
    );
    
    res.json({ success: true, category: result.rows[0] });
  } catch (err) {
    console.error("Add category error:", err);
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post("/delete-category", async (req, res) => {
  try {
    const { categoryId } = req.body;
    if (!categoryId) throw new Error("Category ID required");

    // Check if category is in use
    const booksCount = await db.query(
      "SELECT COUNT(*) FROM books WHERE category_id = $1",
      [categoryId]
    );
    
    if (parseInt(booksCount.rows[0].count) > 0) {
      throw new Error("Cannot delete category with assigned books");
    }

    const result = await db.query(
      "DELETE FROM categories WHERE id = $1 RETURNING id",
      [categoryId]
    );
    
    if (result.rowCount === 0) throw new Error("Category not found");
    
    res.json({ success: true });
  } catch (err) {
    console.error("Delete category error:", err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// Error route
app.get("/error", (req, res) => {
  res.render("error", { error: req.query.error || "An error occurred" });
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

process.on('SIGTERM', () => {
  db.end().then(() => process.exit(0));
});
