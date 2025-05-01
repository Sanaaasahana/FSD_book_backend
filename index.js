import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import env from "dotenv";


// Initialize Express
const app = express();
const port = process.env.PORT || 3000; // Use environment port or 3000
env.config();
app.set('view engine', 'ejs');

// Initialize PostgreSQL client with SSL
const dbConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { 
    rejectUnauthorized: false 
  } : false
};

const db = new pg.Client(dbConfig);


// Database connection with better error handling
async function connectToDatabase() {
  try {
    await db.connect();
    console.log("Connected to PostgreSQL database");
    
    // Verify tables exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL
      );
    `);
    
    await db.query(`
      CREATE TABLE IF NOT EXISTS books (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        isbn VARCHAR(17) UNIQUE NOT NULL,
        description TEXT,
        rating NUMERIC(3,1) CHECK (rating >= 0 AND rating <= 5),
        category_id INTEGER REFERENCES categories(id)
      );
    `);
    
    console.log("Verified database tables");
  } catch (err) {
    console.error("Database connection error:", err);
    process.exit(1);
  }
}

// Connect to database when starting
connectToDatabase();

// Middleware setup

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(express.json()); // For parsing JSON bodies

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Route to render the home page
app.get("/", async (req, res, next) => {
    try {
        // Fetch all books with their categories
        const result = await db.query(`
            SELECT b.*, c.name as category_name 
            FROM books b
            LEFT JOIN categories c ON b.category_id = c.id
            ORDER BY b.id ASC
        `);
        
        // Fetch all categories for the dropdown
        const categoriesResult = await db.query("SELECT * FROM categories ORDER BY id ASC");
        
        res.render("index.ejs", {
            bookItems: result.rows,
            categories: categoriesResult.rows,
        });
    } catch (err) {
        next(err); // Pass errors to the error handler
    }
});

// Route to handle adding a new book
app.post("/add", async (req, res, next) => {
    const { newTitle, newIsbn, newDescription, newRating, category, newCategory } = req.body;

    // Validate input data
    if (!newTitle || newTitle.trim().length === 0) {
        return res.status(400).send("Title is required and cannot be empty.");
    }
    
    if (!newIsbn || !/^\d{10}(\d{3})?$/.test(newIsbn)) {
        return res.status(400).send("Valid ISBN is required (10 or 13 digits).");
    }

    const parsedRating = parseFloat(newRating);
    if (isNaN(parsedRating) || parsedRating < 0 || parsedRating > 5) {
        return res.status(400).send("Rating must be a number between 0 and 5.");
    }

    try {
        let categoryId = category;

        // If a new category is provided, add it to the categories table
        if (newCategory && newCategory.trim().length > 0) {
            const result = await db.query(
                "INSERT INTO categories(name) VALUES ($1) RETURNING id", 
                [newCategory.trim()]
            );
            categoryId = result.rows[0].id;
        }

        // Insert the new book into the database
        await db.query(
            "INSERT INTO books(title, isbn, description, rating, category_id) VALUES ($1, $2, $3, $4, $5)", 
            [
                newTitle.trim(),
                newIsbn,
                newDescription ? newDescription.trim() : null,
                parsedRating,
                categoryId
            ]
        );
        
        res.redirect("/");
    } catch (err) {
        if (err.code === '23505') { // Unique violation (duplicate ISBN)
            res.status(400).send("A book with this ISBN already exists. Please use the edit option.");
        } else {
            next(err);
        }
    }
});

// Add this with your other routes in index.js
app.post('/add-category', async (req, res) => {
    try {
        const { name } = req.body;
        const result = await db.query(
            "INSERT INTO categories(name) VALUES ($1) RETURNING id", 
            [name]
        );
        res.json({ success: true, categoryId: result.rows[0].id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// Route to render the edit form for a selected book
app.get("/edit", async (req, res, next) => {
    const isbnToEdit = req.query.isbn;

    if (!isbnToEdit) {
        return res.status(400).send("ISBN is required for editing.");
    }

    try {
        // Fetch the book with category information
        const bookResult = await db.query(`
            SELECT b.*, c.name as category_name 
            FROM books b
            LEFT JOIN categories c ON b.category_id = c.id
            WHERE b.isbn = $1
        `, [isbnToEdit]);
        
        if (bookResult.rows.length === 0) {
            return res.status(404).send("Book not found.");
        }

        const bookToEdit = bookResult.rows[0];
        const categoriesResult = await db.query("SELECT * FROM categories ORDER BY id ASC");
        
        res.render("edit.ejs", { 
            bookToEdit, 
            categories: categoriesResult.rows 
        });
    } catch (err) {
        next(err);
    }
});

// Route to handle updating a book's information
app.post("/update", async (req, res, next) => {
    const { originalIsbn, updatedTitle, updatedIsbn, updatedDescription, updatedRating, updatedCategory } = req.body;

    // Validate input data
    if (!updatedTitle || updatedTitle.trim().length === 0) {
        return res.status(400).send("Title is required and cannot be empty.");
    }
    
    if (!updatedIsbn || !/^\d{10}(\d{3})?$/.test(updatedIsbn)) {
        return res.status(400).send("Valid ISBN is required (10 or 13 digits).");
    }

    const parsedRating = parseFloat(updatedRating);
    if (isNaN(parsedRating) || parsedRating < 0 || parsedRating > 5) {
        return res.status(400).send("Rating must be a number between 0 and 5.");
    }

    try {
        // Update the book information in the database
        await db.query(`
            UPDATE books 
            SET title = $1, 
                isbn = $2, 
                description = $3, 
                rating = $4, 
                category_id = $5 
            WHERE isbn = $6
        `, [
            updatedTitle.trim(),
            updatedIsbn,
            updatedDescription ? updatedDescription.trim() : null,
            parsedRating,
            updatedCategory,
            originalIsbn
        ]);
        
        res.redirect("/");
    } catch (err) {
        if (err.code === '23505') { // Unique violation (duplicate ISBN)
            res.status(400).send("A book with this ISBN already exists.");
        } else {
            next(err);
        }
    }
});

// Route to handle deleting a book
app.post("/delete", async (req, res, next) => {
    const isbnToDelete = req.body.isbn;

    if (!isbnToDelete) {
        return res.status(400).send("ISBN is required for deletion.");
    }

    try {
        const result = await db.query("DELETE FROM books WHERE isbn = $1 RETURNING *", [isbnToDelete]);
        
        if (result.rowCount === 0) {
            return res.status(404).send("Book not found.");
        }
        
        res.redirect("/");
    } catch (err) {
        next(err);
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

process.on('SIGTERM', () => {
    db.end();
    process.exit(0);
});
