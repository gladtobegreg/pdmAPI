const express = require('express');
const app = express();
app.use(express.json());
const cors = require('cors'); 
const corsOptions = {
    origin:'*',
    credentials:true,
    optionSuccessStatus:200,
}

const productController = require('./controllers/productController');
const PORT = 3000;

app.listen(PORT, () => console.log(`Server started at port ${PORT}`)); 
app.use(express.static('public')); 
app.use(cors(corsOptions));

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