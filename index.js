// index.js
import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import env from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Setup
const app = express();
const port = process.env.PORT || 3000;
env.config();

// EJS Views
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public"));

// DB Config
const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

// Connect to DB
await db.connect();
console.log("Connected to PostgreSQL");

// Ensure Tables
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

// Routes
app.get("/", async (req, res) => {
  try {
    const sortBy = req.query.sort || "title-asc";
    let orderBy = {
      "title-asc": "b.title ASC",
      "title-desc": "b.title DESC",
      "rating-asc": "b.rating ASC NULLS LAST",
      "rating-desc": "b.rating DESC NULLS LAST",
      "category-asc": "c.name ASC NULLS LAST"
    }[sortBy] || "b.id DESC";

    const booksResult = await db.query(`
      SELECT b.*, c.name as category_name
      FROM books b
      LEFT JOIN categories c ON b.category_id = c.id
      ORDER BY ${orderBy};
    `);

    const categories = await db.query("SELECT * FROM categories ORDER BY name ASC;");

    res.render("index", {
      books: booksResult.rows,
      categories: categories.rows,
      sortBy
    });
  } catch (err) {
    console.error("Home Route Error:", err);
    res.status(500).render("error", { error: "Failed to load books." });
  }
});

app.post("/add", async (req, res) => {
  try {
    const { newTitle, newDescription, newRating, category, newCategory } = req.body;
    if (!newTitle?.trim()) throw new Error("Title is required");

    let rating = newRating ? parseFloat(newRating) : null;
    if (rating && (isNaN(rating) || rating < 0 || rating > 5)) {
      throw new Error("Rating must be between 0 and 5");
    }

    let categoryId = category || null;
    if (newCategory?.trim()) {
      try {
        const result = await db.query("INSERT INTO categories(name) VALUES ($1) RETURNING id", [newCategory.trim()]);
        categoryId = result.rows[0].id;
      } catch (err) {
        if (err.code === "23505") {
          const existing = await db.query("SELECT id FROM categories WHERE name = $1", [newCategory.trim()]);
          if (existing.rows.length > 0) categoryId = existing.rows[0].id;
        } else throw err;
      }
    }

    await db.query(
      "INSERT INTO books(title, description, rating, category_id) VALUES ($1, $2, $3, $4)",
      [newTitle.trim(), newDescription?.trim(), rating, categoryId]
    );

    res.redirect("/");
  } catch (err) {
    console.error("Add Book Error:", err);
    const books = await db.query("SELECT b.*, c.name as category_name FROM books b LEFT JOIN categories c ON b.category_id = c.id ORDER BY b.id DESC");
    const categories = await db.query("SELECT * FROM categories ORDER BY name ASC;");
    res.status(400).render("index", {
      books: books.rows,
      categories: categories.rows,
      error: err.message,
      formData: req.body
    });
  }
});

app.get("/edit", async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) throw new Error("Book ID is required");

    const book = await db.query("SELECT * FROM books WHERE id = $1", [id]);
    const categories = await db.query("SELECT * FROM categories ORDER BY name ASC;");

    if (book.rows.length === 0) throw new Error("Book not found");

    res.render("edit", {
      bookToEdit: book.rows[0],
      categories: categories.rows
    });
  } catch (err) {
    console.error("Edit Book Error:", err);
    res.status(400).render("error", { error: err.message });
  }
});

app.post("/update", async (req, res) => {
  try {
    const { id, updatedTitle, updatedDescription, updatedRating, updatedCategory } = req.body;
    if (!id || !updatedTitle?.trim()) throw new Error("Book ID and Title are required");

    const rating = updatedRating ? parseFloat(updatedRating) : null;
    if (rating && (isNaN(rating) || rating < 0 || rating > 5)) {
      throw new Error("Rating must be between 0 and 5");
    }

    await db.query(
      `UPDATE books SET title = $1, description = $2, rating = $3, category_id = $4 WHERE id = $5`,
      [updatedTitle.trim(), updatedDescription?.trim(), rating, updatedCategory || null, id]
    );

    res.redirect("/");
  } catch (err) {
    console.error("Update Book Error:", err);
    res.status(400).render("error", { error: err.message });
  }
});

app.post("/delete", async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) throw new Error("Book ID required");
    await db.query("DELETE FROM books WHERE id = $1", [id]);
    res.redirect("/");
  } catch (err) {
    console.error("Delete Book Error:", err);
    res.status(400).render("error", { error: err.message });
  }
});

app.post("/add-category", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) throw new Error("Category name is required");

    const result = await db.query(
      "INSERT INTO categories(name) VALUES ($1) RETURNING id, name",
      [name.trim()]
    );

    res.json({ success: true, categoryId: result.rows[0].id });
  } catch (err) {
    console.error("Add Category Error:", err);
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post("/delete-category", async (req, res) => {
  try {
    const { categoryId } = req.body;
    if (!categoryId) throw new Error("Category ID required");

    await db.query("UPDATE books SET category_id = NULL WHERE category_id = $1", [categoryId]);
    await db.query("DELETE FROM categories WHERE id = $1", [categoryId]);

    res.json({ success: true });
  } catch (err) {
    console.error("Delete Category Error:", err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err.stack);
  res.status(500).render("error", { error: "Internal server error" });
});

// Start server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

// Handle SIGTERM
process.on("SIGTERM", () => {
  db.end().then(() => process.exit(0));
});
