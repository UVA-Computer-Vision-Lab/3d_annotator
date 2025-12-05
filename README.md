# 3D Bounding Box Annotation Tool

A web-based 3D annotation tool built with Angular 19 and THREE.js for annotating 3D objects in point cloud data. The application provides synchronized 3D and 2D orthogonal views (Top/Front/Side) for precise bounding box editing.

## Features

- Interactive 3D point cloud visualization
- Synchronized 2D orthogonal projections (Top/Front/Side views)
- Real-time bounding box editing with mouse drag
- Automatic camera recentering and zoom: 3D view automatically focuses on selected bounding box
- Dataset browser with annotation progress tracking
- Multi-annotator support with timing statistics

## Prerequisites

- Node.js >= 20.9.0
- npm >= 10.1.0

## Setup

1. **Install dependencies:**
   ```bash
   # Remove existing package-lock.json if present
   rm package-lock.json

   # Install dependencies
   npm install

   # Install Angular CLI globally (if needed)
   npm install -g @angular/cli
   ```

2. **Configure API endpoints:**

   The application uses environment-based configuration for API URLs. By default:
   - **Development mode** (`npm start`): Uses `http://localhost:3000`
   - **Production build** (`ng build`): Uses `http://cvlabhumanrefinement.cs.virginia.edu`

   **To customize API endpoints:**

   Edit the environment configuration files:

   - **For development**: `src/environments/environment.ts`
     ```typescript
     export const environment = {
       production: false,
       apiBaseUrl: 'http://localhost:3000'  // Change this for local development
     };
     ```

   - **For production/deployment**: `src/environments/environment.prod.ts`
     ```typescript
     export const environment = {
       production: true,
       apiBaseUrl: 'http://your-server-address.com'  // Change this for deployment
     };
     ```

   **Quick environment switching:**
   ```bash
   # Use development environment (localhost:3000)
   npm start

   # Use production environment (configured server)
   ng build

   # Or run development server with production config
   ng serve --configuration production
   ```

## Running the Application

The application consists of two components that must run separately:

```bash
# Frontend (Angular) - runs on port 4200
npm start

# Backend (Express) - runs on port 3000
node server.js
```

Access the application at `http://localhost:4200`

## Development Commands

```bash
# Build the application
ng build

# Build with watch mode for development
ng build --watch --configuration development

# Run tests
ng test
```

## Data Structure

### Input Data

Store annotation data locally in `/public/assets/val/<parent_folder>/` with the following required files:

1. `cam_params.json` - Camera intrinsic parameters (K matrix)
2. `input.png` - RGB image
3. `depth_scene.png` - Depth map
4. `3dbbox_ground_no_icp.json` - Initial ground truth bounding boxes

### Output Files

**Annotation output files:**
- `3dbox_refined.json` - Refined bounding box annotations
- `annotation_meta.json` - Annotator info and timing data
- `deleted.json` - Marker for samples opted out of annotation

## Project Structure

- `src/app/app.routes.ts` - Application routing
- `src/app/project_component/folder_list.component.ts` - Dataset browser
- `src/app/viewer_2/UploadPly_2.component.ts` - Main 3D annotation interface
- `src/app/imge_viewer/image_viewer.component.ts` - 2D image viewer with projections
- `server.js` - Express backend API

## API Endpoints

The Express backend (`server.js`) provides the following REST API:

- `GET /api/directory` - Fetch directory structure with pagination
- `GET /api/getindex/:id` - Get page number for specific sample
- `GET /api/getnextunlabeled/:id` - Find next unlabeled sample
- `GET /api/directory-stats` - Get annotation statistics
- `POST /api/save/:id` - Save refined bounding boxes
- `POST /api/save/:id/deleted` - Mark sample as deleted
- `POST /api/save/:id/annotation_meta` - Save annotation metadata

## Technical Notes

- Built with Angular 19.2.5
- Uses THREE.js for 3D rendering
- Point cloud format: PLY files
- 2D views use canvas-based rendering with depth filtering
- Bounding boxes stored with rotation matrices and local dimensions

## Disclaimer

This is a research/laboratory-grade tool intended for internal use only. It has not been security audited or performance optimized for production use. Use at your own risk.
