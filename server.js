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
  exposedHeaders: ['X-Image-Token', 'X-Editor-URL']
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
    
    // Add retention policy to get the X-Image-Token
    if (req.body['policy.retention_days']) {
      formData.append('policy.retention_days', req.body['policy.retention_days']);
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
      // Don't specify responseType - let axios handle it
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    console.log('Response status:', response.status);
    console.log('Response content-type:', response.headers['content-type']);
    console.log('Response data type:', typeof response.data);

    // Check if we got a JSON response (which should contain editor_url)
    if (typeof response.data === 'object' && response.data !== null) {
      console.log('JSON response received');
      
      // Log the editor_url if present
      if (response.data.editor_url) {
        console.log('Editor URL found:', response.data.editor_url);
        // Set it as a header for the frontend
        res.set('X-Editor-URL', response.data.editor_url);
      }

      // Forward the X-Image-Token if present
      if (response.data.vector_token) {
        console.log('Vector token found:', response.data.vector_token);
        res.set('X-Image-Token', response.data.vector_token);
      }

      // Get the actual SVG data
      let svgData;
      if (response.data.svg) {
        svgData = response.data.svg;
      } else if (response.data.data) {
        // Might be base64 encoded
        svgData = Buffer.from(response.data.data, 'base64');
      } else {
        // Try to find the SVG in other possible fields
        svgData = response.data.result || response.data.output || response.data;
      }

      // Set content type
      res.set('Content-Type', 'image/svg+xml');
      res.set('Cache-Control', 'no-store');

      // Send the SVG data
      res.send(svgData);

      console.log(`Successfully processed image: ${req.file.originalname}`);

    } else {
      // Response is not JSON, probably direct SVG/image data
      console.log('Binary/text response received');
      
      // Check headers for tokens
      const imageToken = response.headers['x-image-token'] || 
                         response.headers['X-Image-Token'];
      
      if (imageToken) {
        res.set('X-Image-Token', imageToken);
        console.log('X-Image-Token from header:', imageToken);
      }

      // Set response headers
      res.set({
        'Content-Type': response.headers['content-type'] || 'image/svg+xml',
        'Cache-Control': 'no-store'
      });

      // Send the response data
      res.send(response.data);

      console.log(`Successfully processed image: ${req.file.originalname}`);
    }

  } catch (error) {
    console.error('Error processing request:', error.message);
    
    if (error.response) {
      console.log('Error response status:', error.response.status);
      console.log('Error response headers:', error.response.headers);
      
      res.status(error.response.status).json({
        error: 'Vectorizer.ai API error',
        message: error.response.data.toString() || error.message,
        status: error.response.status
      });
    } else {
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
