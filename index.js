import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import env from "dotenv";

// Initialize Express
const app = express();
const port = 3000;
env.config();
app.set('view engine', 'ejs');

// Initialize PostgreSQL client
const db = new pg.Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
})

// Connect to the database
db.connect();

// Middleware setup
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// Array to store books data
let books = [];

// Route to render the home page
app.get("/", async (req, res) => {
    try {
        const sortBy = req.query.sort || 'id-asc';
        let orderBy = '';
        
        switch(sortBy) {
            case 'title-asc':
                orderBy = 'title ASC';
                break;
            case 'title-desc':
                orderBy = 'title DESC';
                break;
            case 'rating-asc':
                orderBy = 'rating ASC NULLS LAST';
                break;
            case 'rating-desc':
                orderBy = 'rating DESC NULLS LAST';
                break;
            case 'category-asc':
                orderBy = 'category_id ASC NULLS LAST';
                break;
            default:
                orderBy = 'id ASC';
        }

        // Fetch all books and categories from the database with sorting
        const booksResult = await db.query(`
            SELECT b.*, c.name as category_name 
            FROM books b
            LEFT JOIN categories c ON b.category_id = c.id
            ORDER BY ${orderBy}
        `);
        
        const categoriesResult = await db.query("SELECT * FROM categories ORDER BY id ASC");
        books = booksResult.rows;
        const categories = categoriesResult.rows;

        // Render the home page with the list of books and categories
        res.render("index.ejs", {
            bookItems: books,
            categories: categories,
            sortBy: sortBy
        });
    } catch (err) {
        console.log(err);
        res.status(500).send("Internal Server Error");
    }
});

// Route to handle adding a new book
app.post("/add", async (req, res) => {
    const { newTitle, newDescription, newRating, category, newCategory } = req.body;

    // Validate input data
    if (!newTitle) {
        return res.status(400).send("Title is required.");
    }
    const parsedRating = newRating ? parseFloat(newRating) : null;
    if (parsedRating && (isNaN(parsedRating) || parsedRating < 0 || parsedRating > 5) {
        return res.status(400).send("Rating must be a number between 0 and 5.");
    }

    try {
        let categoryId = category || null;

        // If a new category is provided, add it to the categories table
        if (newCategory) {
            const result = await db.query("INSERT INTO categories(name) VALUES ($1) RETURNING id", [newCategory]);
            categoryId = result.rows[0].id;
        }

        // Insert the new book into the database, including the category id (ISBN removed)
        await db.query("INSERT INTO books(title, description, rating, category_id) VALUES ($1, $2, $3, $4)", 
            [newTitle, newDescription, parsedRating, categoryId]);
        res.redirect("/");
    } catch (err) {
        console.log(err);
        res.status(500).send("Error adding book: " + err.message);
    }
});

// Route to render the edit form for a selected book
app.get("/edit", async (req, res) => {
    const idToEdit = req.query.id;

    try {
        // Fetch the book and categories from the database
        const bookResult = await db.query(`
            SELECT b.*, c.name as category_name 
            FROM books b 
            LEFT JOIN categories c ON b.category_id = c.id 
            WHERE b.id = $1
        `, [idToEdit]);
        
        const bookToEdit = bookResult.rows[0];
        const categoriesResult = await db.query("SELECT * FROM categories ORDER BY id ASC");
        const categories = categoriesResult.rows;

        // Render the edit form with the existing book data and categories
        res.render("edit.ejs", { 
            bookToEdit, 
            categories 
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Internal Server Error");
    }
});

// Route to handle updating a book's information
app.post("/update", async (req, res) => {
    const { id, updatedTitle, updatedDescription, updatedRating, updatedCategory } = req.body;

    // Validate input data
    if (!updatedTitle) {
        return res.status(400).send("Title is required.");
    }

    const parsedRating = updatedRating ? parseFloat(updatedRating) : null;
    if (parsedRating && (isNaN(parsedRating) || parsedRating < 0 || parsedRating > 5) {
        return res.status(400).send("Rating must be a number between 0 and 5.");
    }

    try {
        // Update the book information in the database (ISBN removed)
        await db.query(`
            UPDATE books 
            SET title = $1, description = $2, rating = $3, category_id = $4 
            WHERE id = $5
        `, [updatedTitle, updatedDescription, parsedRating, updatedCategory || null, id]);

        res.redirect("/");
    } catch (err) {
        console.error(err);
        res.status(500).send("Internal Server Error");
    }
});

// Route to handle deleting a book
app.post("/delete", async (req, res) => {
    const idToDelete = req.body.id;

    try {
        // Delete the book from the database
        await db.query("DELETE FROM books WHERE id = $1", [idToDelete]);
        res.redirect("/");
    } catch (err) {
        console.error(err);
        res.status(500).send("Internal Server Error");
    }
});

// Route to handle adding a new category
app.post("/add-category", async (req, res) => {
    const { name } = req.body;
    
    if (!name) {
        return res.status(400).json({ success: false, error: "Category name is required" });
    }

    try {
        const result = await db.query(
            "INSERT INTO categories(name) VALUES ($1) RETURNING id, name",
            [name]
        );
        res.json({ success: true, category: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: "Error adding category" });
    }
});

// Route to handle deleting a category
app.post("/delete-category", async (req, res) => {
    const { categoryId } = req.body;
    
    if (!categoryId) {
        return res.status(400).json({ success: false, error: "Category ID is required" });
    }

    try {
        // First set books with this category to NULL
        await db.query(
            "UPDATE books SET category_id = NULL WHERE category_id = $1",
            [categoryId]
        );
        
        // Then delete the category
        await db.query(
            "DELETE FROM categories WHERE id = $1",
            [categoryId]
        );
        
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: "Error deleting category" });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
