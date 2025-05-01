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
        // Fetch all books and categories from the database
        const booksResult = await db.query("SELECT * FROM books ORDER BY id ASC");
        const categoriesResult = await db.query("SELECT * FROM categories ORDER BY id ASC");
        books = booksResult.rows;
        const categories = categoriesResult.rows;

        // Render the home page with the list of books and categories
        res.render("index.ejs", {
            bookItems: books,
            categories: categories,
        });
    } catch (err) {
        console.log(err);
    }
});

// Route to handle adding a new book
app.post("/add", async (req, res) => {
    const { newTitle, newIsbn, newDescription, newRating, category, newCategory } = req.body;

    // Validate input data
    if (!newTitle) {
        return res.status(400).send("Title is required.");
    }
    const parsedRating = parseFloat(newRating);
    if (isNaN(parsedRating) || parsedRating < 0 || parsedRating > 5) {
        return res.status(400).send("Rating must be a number between 0 and 5.");
    }

    try {
        let categoryId = category;

        // If a new category is provided, add it to the categories table
        if (newCategory) {
            const result = await db.query("INSERT INTO categories(name) VALUES ($1) RETURNING id", [newCategory]);
            categoryId = result.rows[0].id;
        }

        // Insert the new book into the database, including the category id
        await db.query("INSERT INTO books(title,isbn,description,rating,category_id) VALUES ($1,$2,$3,$4,$5)", 
            [newTitle, newIsbn, newDescription, newRating, categoryId]);
        res.redirect("/");
    } catch (err) {
        console.log(err);
        res.status(500).send("The book already exists. Update/Edit option can be utilized.");
    }
});

// Route to render the edit form for a selected book
app.get("/edit", async (req, res) => {
    const isbnToEdit = req.query.isbn;

    try {
        // Fetch the book and categories from the database
        const bookResult = await db.query("SELECT * FROM books WHERE isbn = $1", [isbnToEdit]);
        const bookToEdit = bookResult.rows[0];
        const categoriesResult = await db.query("SELECT * FROM categories ORDER BY id ASC");
        const categories = categoriesResult.rows;

        // Render the edit form with the existing book data and categories
        res.render("edit.ejs", { bookToEdit, categories });
    } catch (err) {
        console.error(err);
        res.status(500).send("Internal Server Error");
    }
});

// Route to handle updating a book's information
app.post("/update", async (req, res) => {
    const { updatedTitle, updatedIsbn, updatedDescription, updatedRating, updatedCategory } = req.body;

    // Validate input data
    if (!updatedTitle) {
        return res.status(400).send("Title is required.");
    }

    const parsedRating = parseFloat(updatedRating);
    if (isNaN(parsedRating) || parsedRating < 0 || parsedRating > 5) {
        return res.status(400).send("Rating must be a number between 0 and 5.");
    }

    try {
        // Update the book information in the database
        await db.query("UPDATE books SET title = $1, description = $2, rating = $3, category_id = $4 WHERE isbn = $5",
            [updatedTitle, updatedDescription, updatedRating, updatedCategory, updatedIsbn]);

        res.redirect("/");
    } catch (err) {
        console.error(err);
        res.status(500).send("Internal Server Error");
    }
});

// Route to handle deleting a book
app.post("/delete", async (req, res) => {
    const isbnToDelete = req.body.isbn;

    try {
        // Delete the book from the database
        await db.query("DELETE FROM books WHERE isbn = $1", [isbnToDelete]);
        res.redirect("/");
    } catch (err) {
        console.error(err);
        res.status(500).send("Internal Server Error");
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
