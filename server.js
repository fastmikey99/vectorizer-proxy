const express = require('express');
const multer = require('multer');
const FormData = require('form-data');
const axios = require('axios');
const cors = require('cors');

const app = express();

// Get environment variables with defaults for local development
const PORT = process.env.PORT || 3000;
const VECTORIZER_API_ID = process.env.VECTORIZER_API_ID || 'vk59likstw9srmd';
const VECTORIZER_API_SECRET = process.env.VECTORIZER_API_SECRET || '4b5de8csubos5tmq8q4hcs8emtj5rgnf4107ai2grsrg15qtj3bf';

// Enable CORS for all origins (you can restrict this in production)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['X-Image-Token']
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'vectorizer-proxy',
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Vectorizer Proxy is running',
    endpoints: {
      health: '/health',
      vectorize: '/vectorize (POST)'
    }
  });
});

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Main vectorize endpoint
app.post('/vectorize', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    console.log(`Processing image: ${req.file.originalname} (${req.file.size} bytes)`);
    console.log('Request body parameters:', req.body);

    // Create form data for Vectorizer.ai API
    const formData = new FormData();
    formData.append('image', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });

    // Add all processing parameters
    if (req.body.mode) {
      formData.append('mode', req.body.mode);
    }
    if (req.body['processing.max_colors']) {
      formData.append('processing.max_colors', req.body['processing.max_colors']);
    }
    if (req.body['output.group_by_color']) {
      formData.append('output.group_by_color', req.body['output.group_by_color']);
    }
    if (req.body['output.illustrator_compatibility']) {
      formData.append('output.illustrator_compatibility', req.body['output.illustrator_compatibility']);
    }

    // Make request to Vectorizer.ai
    const response = await axios.post('https://vectorizer.ai/api/v1/vectorize', formData, {
      auth: {
        username: VECTORIZER_API_ID,
        password: VECTORIZER_API_SECRET
      },
      headers: {
        ...formData.getHeaders()
      },
      responseType: 'arraybuffer',
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    // Log all response headers for debugging
    console.log('Response headers:', response.headers);

    // Set response headers
    res.set({
      'Content-Type': response.headers['content-type'] || 'image/svg+xml',
      'Cache-Control': 'no-store'
    });

    // Forward the X-Image-Token header (check multiple case variations)
    const imageToken = response.headers['x-image-token'] || 
                       response.headers['X-Image-Token'] || 
                       response.headers['X-IMAGE-TOKEN'];
    
    if (imageToken) {
      res.set('X-Image-Token', imageToken);
      console.log('Forwarding X-Image-Token:', imageToken);
    } else {
      console.log('No X-Image-Token found in response headers');
    }

    // Send the response
    res.send(Buffer.from(response.data));

    console.log(`Successfully processed image: ${req.file.originalname}`);

  } catch (error) {
    console.error('Error processing request:', error.message);
    
    if (error.response) {
      // Forward error from Vectorizer.ai
      res.status(error.response.status).json({
        error: 'Vectorizer.ai API error',
        message: error.response.data.toString() || error.message,
        status: error.response.status
      });
    } else {
      // General error
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    message: `Cannot ${req.method} ${req.url}`
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Vectorizer proxy running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`API endpoint: http://localhost:${PORT}/vectorize`);
  
  // Check if API credentials are set
  if (!VECTORIZER_API_ID || !VECTORIZER_API_SECRET) {
    console.warn('WARNING: API credentials not set in environment variables!');
  }
});
