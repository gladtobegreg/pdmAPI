import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Persistent paths
const dataDir = path.join(__dirname, 'data');
const barcodeFolderDirectory = path.join(dataDir, 'barcodes', '/');
const jsonDbPath = path.join(dataDir, 'pdmDb.json');

// Use barcodeFolderDirectory when generating images
// Use jsonDbPath when reading/writing the JSON database

const express = require('express');
const cors = require('cors');
const productController = require('./controllers/productController');

const app = express();
const PORT = process.env.PORT || 8080;

const corsOptions = {
  origin: '*', // Replace with your frontend origin in production
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200,
};

// Middleware
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());
app.use(express.static('public'));

// Serve /barcodes/image files at the /api/barcodes/ endpoint
app.use('/api/barcodes', express.static('barcodes'));

//Define routes
app.get('/api/products', productController.getAllProducts);
app.get('/api/products/product', productController.getProductById); // Includes data sent as query
app.get('/api/products/category', productController.getProductsByCategory); // Includes data sent as query
app.get('/api/products/random', productController.getRandomProducts); // Includes data sent as query
app.post('/api/login', productController.getAccess); // Includes data sent as object
app.post('/api/products/addProduct', productController.createProduct); // Includes data sent as object
app.patch('/api/products/updateProduct', productController.updateProduct); // Includes data sent as object
app.delete('/api/products/deleteProduct', productController.deleteProduct); // Includes data sent as query

// NEW app routes
app.post('/api/categories/addCategory', productController.createCategory);
app.patch('/api/categories/updateCategory', productController.updateCategory);
app.delete('/api/categories/deleteCategory', productController.deleteCategory);
app.get('/api/sanityCheck', productController.sanityCheck);
app.post('/api/sanityCheck', productController.sanityCheck);
app.patch('/api/sanityCheck', productController.sanityCheck);
app.delete('/api/sanityCheck', productController.sanityCheck);

// Start server
app.listen(PORT, () => console.log(`Server started at port ${PORT}`));