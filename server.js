const path = require('path');

// Persistent paths
const dataDir = path.join(__dirname, '..', 'data');
const barcodeFolderDirectory = path.join(dataDir, 'barcodes');
const jsonDbPath = path.join(dataDir, 'pdmDb.json');

// Debug logs to confirm paths
console.log("Data directory:", dataDir);
console.log("Barcode folder directory:", barcodeFolderDirectory);
console.log("JSON DB path:", jsonDbPath);

module.exports = {
  dataDir,
  barcodeFolderDirectory,
  jsonDbPath
};

// Use barcodeFolderDirectory when generating images
// Use jsonDbPath when reading/writing the JSON database

const express = require('express');
const cors = require('cors');
const productController = require('./controllers/productController');

const app = express();
const hostname = "0.0.0.0";
const port = process.env.port || 8080;

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
app.use('/api/barcodes', express.static(barcodeFolderDirectory));

//Define routes
app.get('/api/products', productController.getAllProducts);
app.get('/api/products/product', productController.getProductById); // Includes data sent as query
app.get('/api/products/category', productController.getProductsByCategory); // Includes data sent as query
app.get('/api/products/random', productController.getRandomProducts); // Includes data sent as query
app.post('/api/login', productController.getAccess); // Includes data sent as object
app.post('/api/products/addProduct', productController.createProduct); // Includes data sent as object
app.patch('/api/products/updateProduct', productController.updateProduct); // Includes data sent as object
app.delete('/api/products/deleteProduct', productController.deleteProduct); // Includes data sent as query

app.post('/api/categories/addCategory', productController.createCategory);
app.patch('/api/categories/updateCategory', productController.updateCategory);
app.delete('/api/categories/deleteCategory', productController.deleteCategory);

app.post('/api/newUser', productController.createNewUser);

app.get('/test-barcode', (req, res) => {
  const filePath = path.join(barcodeFolderDirectory, '123123123123.png');
  console.log("The used file path was...", filePath);
  res.sendFile(filePath, err => {
    if (err) {
      console.error("Error sending file:", err);
      res.status(404).send("File not found");
    }
  });
});

// Start server
app.listen(port, hostname, () => console.log(`Server started at http://${hostname}:${port}/`));