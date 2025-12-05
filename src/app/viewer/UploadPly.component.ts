import { Component, ElementRef, OnInit, OnDestroy, ViewChild, AfterViewInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import * as THREE from 'three';
import { GLTFLoader, PLYLoader } from 'three/examples/jsm/Addons.js';
import { CommonModule } from '@angular/common';
import { TrackballControls } from 'three/examples/jsm/Addons.js';

interface BoundingBoxData {
  obj_id: string;
  category_name: string;
  center_cam: number[];
  R_cam: number[][];
  dimensions: number[];
  bbox3D_cam: number[][];
}

enum CornerEditMode {
  None,
  Width,  // X dimension
  Length, // Y dimension
  Height, // Z dimension
  Center, // Move entire box
  Rotation // Rotate the box
}

interface BoundingBoxEditData {
  centerX: number;
  centerY: number;
  centerZ: number;
  dimensionX: number;
  dimensionY: number;
  dimensionZ: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  originalVertices?: number[];
  originalCenter?: THREE.Vector3;
  originalDimensions?: THREE.Vector3;
}

@Component({
    selector: 'app-ply-viewer',
    imports: [CommonModule, FormsModule],
    standalone: true,
    templateUrl: './UploadPly.component.html',
    styleUrl: './UploadPly.component.css'
  })
export class PlyViewerComponent implements OnInit, OnDestroy {
  @ViewChild('rendererContainer', { static: true }) 
  rendererContainer!: ElementRef;

  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private trackballControls!: TrackballControls;
  
  private pointCloud: THREE.Points | null = null;
  private glbModel: THREE.Group | null = null;
  private boundingBoxMesh: THREE.LineSegments | null = null;
  private boundingBoxCorners: THREE.Mesh[] = [];

  private axesHelper!: THREE.AxesHelper;
  isEditMode = false;

  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  pointCloudStats: {
    points: number;
    boundingBox: {
      min: THREE.Vector3;
      max: THREE.Vector3;
    }
  } | null = null;

  pointSize: number = 0.05;

  private cornerEditMode: CornerEditMode = CornerEditMode.None;
  private originalCornerPositions: THREE.Vector3[] = [];
  private startDragPosition: THREE.Vector3 = new THREE.Vector3();
  private initialScale: THREE.Vector3 = new THREE.Vector3(1, 1, 1); // Store initial normalized scale
  private cornerColors = {
    width: 0xff0000,   // Red for width (X)
    length: 0x00ff00,  // Green for length (Y)
    height: 0x0000ff,  // Blue for height (Z)
    center: 0xffff00,  // Yellow for center
    rotation: 0xff00ff // Magenta for rotation
  };

  private selectedCorner: THREE.Mesh | null = null;

    // New property for bounding box editing
    boundingBoxEditData: {
        centerX: number;
        centerY: number;
        centerZ: number;
        dimensionX: number;
        dimensionY: number;
        dimensionZ: number;
        rotationX: number;
        rotationY: number;
        rotationZ: number;
        originalVertices?: number[];
        originalCenter?: THREE.Vector3;
        originalDimensions?: THREE.Vector3;
         // Added properties for normalized scale
        normalizedRatioX?: number;
        normalizedRatioY?: number;
        normalizedRatioZ?: number;
      } | null = null;


      ngOnInit() {
        this.initScene();
        this.setupEventListeners();
        this.animate();
      }

      ngAfterViewInit() {
        // Ensure the container is ready
        setTimeout(() => {
          this.onWindowResize();
          this.renderer.render(this.scene, this.camera);
        }, 100);
      }
    
      private initScene() {
        // Scene setup (similar to previous implementation)
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xf0f0f0);
    
        const container = this.rendererContainer.nativeElement;
    
        this.renderer = new THREE.WebGLRenderer({ 
          antialias: true,
          alpha: true 
        });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        
        this.renderer.setSize(
          container.clientWidth || window.innerWidth, 
          container.clientHeight || 500
        );
        
        container.innerHTML = '';
        container.appendChild(this.renderer.domElement);
    
        this.camera = new THREE.PerspectiveCamera(
          45, 
          (container.clientWidth || window.innerWidth) / (container.clientHeight || 500), 
          0.1, 
          1000
        );
    
        this.trackballControls = new TrackballControls(this.camera, this.renderer.domElement);
        
        this.trackballControls.rotateSpeed = 1.0;
        this.trackballControls.zoomSpeed = 1.2;
        this.trackballControls.panSpeed = 0.8;
    
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        this.scene.add(ambientLight);
        
        const directionalLight1 = new THREE.DirectionalLight(0xffffff, 0.5);
        directionalLight1.position.set(1, 1, 1);
        this.scene.add(directionalLight1);
    
        const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
        directionalLight2.position.set(-1, -1, -1);
        this.scene.add(directionalLight2);
    
        this.axesHelper = new THREE.AxesHelper(10);
        this.scene.add(this.axesHelper);
    
        this.camera.position.z = 5;
      }

      private onWindowResize = () => {
        const container = this.rendererContainer.nativeElement;
        
        // Update camera aspect ratio
        this.camera.aspect = container.clientWidth / container.clientHeight;
        this.camera.updateProjectionMatrix();

        // Update renderer size
        this.renderer.setSize(container.clientWidth, container.clientHeight);
      }
    
      private setupEventListeners() {
        window.addEventListener('resize', this.onWindowResize);
        window.addEventListener('keydown', this.onKeyDown);
        this.rendererContainer.nativeElement.addEventListener('mousedown', this.onMouseDown);
        this.rendererContainer.nativeElement.addEventListener('mousemove', this.onMouseMove);
        this.rendererContainer.nativeElement.addEventListener('mouseup', this.onMouseUp);
      }
    
      private onKeyDown = (event: KeyboardEvent) => {
        // Shift key to toggle edit mode
        if (event.shiftKey) {
          this.toggleEditMode();
        }
    
        // Space key to exit edit mode if in edit mode
        if (event.code === 'Space' && this.isEditMode) {
          this.toggleEditMode();
        }
      }
    
      private toggleEditMode() {
        this.isEditMode = !this.isEditMode;
    
        if (this.isEditMode) {
          // Disable trackball controls when in edit mode
          this.trackballControls.enabled = false;
          this.createBoundingBoxCorners();
        } else {
          // Re-enable trackball controls when exiting edit mode
          this.trackballControls.enabled = true;
          this.removeBoundingBoxCorners();
        }
      }

      // Update your onMouseDown method
      private onMouseDown = (event: MouseEvent) => {
        if (!this.isEditMode) return;

        // Calculate mouse position in normalized device coordinates
        const container = this.rendererContainer.nativeElement;
        this.mouse.x = (event.clientX / container.clientWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / container.clientHeight) * 2 + 1;

        // Set up the raycaster
        this.raycaster.setFromCamera(this.mouse, this.camera);

        // Check for intersections with corner markers
        const intersects = this.raycaster.intersectObjects(this.boundingBoxCorners);

        if (intersects.length > 0) {
          this.selectedCorner = intersects[0].object as THREE.Mesh;
          this.cornerEditMode = this.selectedCorner.userData['editMode'];
          
          // Store the starting drag position for calculations
          this.startDragPosition = this.selectedCorner.position.clone();
          
          // Store current bounding box parameters for relative calculations
          if (this.boundingBoxEditData) {
            this.boundingBoxEditData.originalCenter = new THREE.Vector3(
              this.boundingBoxEditData.centerX,
              this.boundingBoxEditData.centerY,
              this.boundingBoxEditData.centerZ
            );
            this.boundingBoxEditData.originalDimensions = new THREE.Vector3(
              this.boundingBoxEditData.dimensionX,
              this.boundingBoxEditData.dimensionY,
              this.boundingBoxEditData.dimensionZ
            );
          }
        }
      }

      // Update your onMouseMove method to handle different edit modes with normalization
      private onMouseMove = (event: MouseEvent) => {
        if (!this.isEditMode || !this.selectedCorner || !this.boundingBoxMesh || !this.boundingBoxEditData) return;

        // Calculate mouse position in normalized device coordinates
        const container = this.rendererContainer.nativeElement;
        this.mouse.x = (event.clientX / container.clientWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / container.clientHeight) * 2 + 1;

        // Raycast to find the new position
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(this.mouse, this.camera);
        
        // Create a plane that's appropriate for the current edit mode
        let plane;
        const cameraDirection = this.camera.getWorldDirection(new THREE.Vector3());
        
        switch (this.cornerEditMode) {
          case CornerEditMode.Width:
            // For width editing, create a plane perpendicular to Y-Z plane
            plane = new THREE.Plane(new THREE.Vector3(0, 0, 1).cross(new THREE.Vector3(0, 1, 0)).normalize());
            break;
          case CornerEditMode.Length:
            // For length editing, create a plane perpendicular to X-Z plane
            plane = new THREE.Plane(new THREE.Vector3(1, 0, 0).cross(new THREE.Vector3(0, 0, 1)).normalize());
            break;
          case CornerEditMode.Height:
            // For height editing, create a plane perpendicular to X-Y plane
            plane = new THREE.Plane(new THREE.Vector3(1, 0, 0).cross(new THREE.Vector3(0, 1, 0)).normalize());
            break;
          default:
            // For other modes, use a plane perpendicular to camera direction
            plane = new THREE.Plane(cameraDirection);
        }
        
        // Position the plane at the corner's position
        plane.translate(this.selectedCorner.position);

        // Find intersection point with the plane
        const intersectionPoint = new THREE.Vector3();
        raycaster.ray.intersectPlane(plane, intersectionPoint);
        
        if (!intersectionPoint) return;
        
        // Handle based on the edit mode
        switch (this.cornerEditMode) {
          case CornerEditMode.Width:
            this.updateDimensionMaintainingNormalizedScale(intersectionPoint, 'x');
            break;
          case CornerEditMode.Length:
            this.updateDimensionMaintainingNormalizedScale(intersectionPoint, 'y');
            break;
          case CornerEditMode.Height:
            this.updateDimensionMaintainingNormalizedScale(intersectionPoint, 'z');
            break;
          case CornerEditMode.Center:
            this.updateCenter(intersectionPoint);
            break;
          case CornerEditMode.Rotation:
            this.updateRotation(intersectionPoint);
            break;
        }
        
        // Recreate the bounding box with updated parameters
        this.recreateBoundingBoxFromParameters();
      }

      private updateDimensionMaintainingNormalizedScale(newPosition: THREE.Vector3, axis: 'x' | 'y' | 'z') {
        if (!this.boundingBoxEditData || !this.selectedCorner || !this.boundingBoxEditData.originalDimensions) return;
        
        // Calculate the difference from starting position
        const delta = newPosition[axis] - this.startDragPosition[axis];
        
        // Update the primary dimension based on the axis
        let newDimension = 0;
        switch (axis) {
          case 'x':
            newDimension = Math.max(0.1, this.boundingBoxEditData.originalDimensions.x + delta * 2);
            this.boundingBoxEditData.dimensionX = newDimension;
            
            // Update Y and Z dimensions to maintain normalized scale ratios
            if (this.boundingBoxEditData.normalizedRatioY) {
              this.boundingBoxEditData.dimensionY = newDimension * this.boundingBoxEditData.normalizedRatioY;
            }
            if (this.boundingBoxEditData.normalizedRatioZ) {
              this.boundingBoxEditData.dimensionZ = newDimension * this.boundingBoxEditData.normalizedRatioZ;
            }
            break;
            
          case 'y':
            newDimension = Math.max(0.1, this.boundingBoxEditData.originalDimensions.y + delta * 2);
            this.boundingBoxEditData.dimensionY = newDimension;
            
            // Update X and Z to maintain normalized scale ratios
            if (this.boundingBoxEditData.normalizedRatioY) {
              const scaleFactor = newDimension / this.boundingBoxEditData.normalizedRatioY;
              this.boundingBoxEditData.dimensionX = scaleFactor;
              if (this.boundingBoxEditData.normalizedRatioZ) {
                this.boundingBoxEditData.dimensionZ = scaleFactor * this.boundingBoxEditData.normalizedRatioZ;
              }
            }
            break;
            
          case 'z':
            newDimension = Math.max(0.1, this.boundingBoxEditData.originalDimensions.z + delta * 2);
            this.boundingBoxEditData.dimensionZ = newDimension;
            
            // Update X and Y to maintain normalized scale ratios
            if (this.boundingBoxEditData.normalizedRatioZ) {
              const scaleFactor = newDimension / this.boundingBoxEditData.normalizedRatioZ;
              this.boundingBoxEditData.dimensionX = scaleFactor;
              if (this.boundingBoxEditData.normalizedRatioY) {
                this.boundingBoxEditData.dimensionY = scaleFactor * this.boundingBoxEditData.normalizedRatioY;
              }
            }
            break;
        }

        // Update the control point position to follow the mouse
        this.selectedCorner.position[axis] = newPosition[axis];
      }
      
      
      private updateCenter(newPosition: THREE.Vector3) {
        if (!this.boundingBoxEditData || !this.boundingBoxEditData.originalCenter || !this.selectedCorner) return;
        
        // Calculate the difference from starting position
        const deltaX = newPosition.x - this.startDragPosition.x;
        const deltaY = newPosition.y - this.startDragPosition.y;
        const deltaZ = newPosition.z - this.startDragPosition.z;
        
        // Update the center position
        this.boundingBoxEditData.centerX = this.boundingBoxEditData.originalCenter.x + deltaX;
        this.boundingBoxEditData.centerY = this.boundingBoxEditData.originalCenter.y + deltaY;
        this.boundingBoxEditData.centerZ = this.boundingBoxEditData.originalCenter.z + deltaZ;
        
        // Update the control point position
        this.selectedCorner.position.copy(newPosition);
      }
      
      // Method to update rotation
      private updateRotation(newPosition: THREE.Vector3) {
        if (!this.boundingBoxEditData || !this.selectedCorner) return;
        
        // Calculate angle change based on movement in XZ plane (around Y axis)
        const center = new THREE.Vector3(
          this.boundingBoxEditData.centerX,
          this.boundingBoxEditData.centerY,
          this.boundingBoxEditData.centerZ
        );
        
        const startVector = new THREE.Vector3(
          this.startDragPosition.x - center.x,
          0,
          this.startDragPosition.z - center.z
        ).normalize();
        
        const currentVector = new THREE.Vector3(
          newPosition.x - center.x,
          0,
          newPosition.z - center.z
        ).normalize();
        
        // Calculate angle between vectors
        const angle = Math.atan2(
          startVector.z * currentVector.x - startVector.x * currentVector.z,
          startVector.x * currentVector.x + startVector.z * currentVector.z
        );
        
        // Update rotation (assuming Y-up coordinate system)
        this.boundingBoxEditData.rotationY += angle * (180 / Math.PI);
        
        // Update control position but keep it at fixed distance from center
        const distance = new THREE.Vector3(
          this.startDragPosition.x - center.x,
          this.startDragPosition.y - center.y,
          this.startDragPosition.z - center.z
        ).length();
        
        const newControlPos = new THREE.Vector3(
          center.x + currentVector.x * distance,
          this.selectedCorner.position.y,
          center.z + currentVector.z * distance
        );
        
        this.selectedCorner.position.copy(newControlPos);
        this.startDragPosition.copy(newControlPos);
      }
      
      private recreateBoundingBoxFromParameters() {
        if (!this.boundingBoxEditData || !this.boundingBoxMesh) return;
        
        // Get parameters
        const center = new THREE.Vector3(
          this.boundingBoxEditData.centerX,
          this.boundingBoxEditData.centerY,
          this.boundingBoxEditData.centerZ
        );
        
        const dimensions = new THREE.Vector3(
          this.boundingBoxEditData.dimensionX,
          this.boundingBoxEditData.dimensionY,
          this.boundingBoxEditData.dimensionZ
        );
        
        const rotation = new THREE.Euler(
          this.boundingBoxEditData.rotationX * (Math.PI / 180),
          this.boundingBoxEditData.rotationY * (Math.PI / 180),
          this.boundingBoxEditData.rotationZ * (Math.PI / 180)
        );
        
        // Create vertices for bounding box
        const halfWidth = dimensions.x / 2;
        const halfHeight = dimensions.y / 2;
        const halfDepth = dimensions.z / 2;
        
        // Define the 8 corners of the box (local coordinates)
        const vertices = [
          new THREE.Vector3(-halfWidth, -halfHeight, -halfDepth),  // 0: left front bottom
          new THREE.Vector3(halfWidth, -halfHeight, -halfDepth),   // 1: right front bottom
          new THREE.Vector3(halfWidth, -halfHeight, halfDepth),    // 2: right back bottom
          new THREE.Vector3(-halfWidth, -halfHeight, halfDepth),   // 3: left back bottom
          new THREE.Vector3(-halfWidth, halfHeight, -halfDepth),   // 4: left front top
          new THREE.Vector3(halfWidth, halfHeight, -halfDepth),    // 5: right front top
          new THREE.Vector3(halfWidth, halfHeight, halfDepth),     // 6: right back top
          new THREE.Vector3(-halfWidth, halfHeight, halfDepth)     // 7: left back top
        ];
        
        // Create rotation matrix
        const rotationMatrix = new THREE.Matrix4().makeRotationFromEuler(rotation);
        
        // Apply rotation and translation to each vertex
        const transformedVertices = vertices.map(vertex => {
          const rotated = vertex.clone().applyMatrix4(rotationMatrix);
          return [
            rotated.x + center.x,
            rotated.y + center.y,
            rotated.z + center.z
          ];
        }).flat();
        
        // Define edges
        const edgeIndices = [
          0, 1, 1, 2, 2, 3, 3, 0,  // Bottom face
          4, 5, 5, 6, 6, 7, 7, 4,  // Top face
          0, 4, 1, 5, 2, 6, 3, 7   // Connecting edges
        ];
        
        // Create line segments geometry
        const edgeVertices = edgeIndices.map(index => {
          const i = index * 3;
          return [transformedVertices[i], transformedVertices[i+1], transformedVertices[i+2]];
        }).flat();
        
        // Update the bounding box mesh
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(edgeVertices, 3));
        
        // Remove old mesh and create new one
        this.scene.remove(this.boundingBoxMesh);
        this.boundingBoxMesh = new THREE.LineSegments(
          geometry,
          new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 2 })
        );
        this.scene.add(this.boundingBoxMesh);
        
        // Update control point positions based on new box dimensions
        this.updateControlPointPositions();
      }
      
      // Method to update control point positions after box is modified
      private updateControlPointPositions() {
        if (!this.boundingBoxCorners.length || !this.boundingBoxMesh) return;
        
        // Get up-to-date box parameters
        const center = new THREE.Vector3(
          this.boundingBoxEditData!.centerX,
          this.boundingBoxEditData!.centerY,
          this.boundingBoxEditData!.centerZ
        );
        
        const dimensions = new THREE.Vector3(
          this.boundingBoxEditData!.dimensionX,
          this.boundingBoxEditData!.dimensionY,
          this.boundingBoxEditData!.dimensionZ
        );
        
        // Get the box geometry
        const geometry = this.boundingBoxMesh.geometry;
        const positions = geometry.getAttribute('position');
        
        // Find unique vertices (8 corners from 24 positions in the line segments)
        const uniqueVertices = new Map<string, THREE.Vector3>();
        for (let i = 0; i < positions.count; i++) {
          const x = positions.getX(i);
          const y = positions.getY(i);
          const z = positions.getZ(i);
          const key = `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
          
          if (!uniqueVertices.has(key)) {
            uniqueVertices.set(key, new THREE.Vector3(x, y, z));
          }
        }
        
        const vertices = Array.from(uniqueVertices.values());
        
        // Define fixed corner indices for each control
        // 0: width control (right front bottom)
        // 1: length control (left back bottom)
        // 2: height control (left front top)
        
        // Update width control (red) - right front bottom
        if (this.boundingBoxCorners[0]) {
          // Find the vertex with max X, min Y, min Z
          const rightFrontBottom = vertices.reduce((best, v) => {
            if (v.x > best.x) return v;
            return best;
          }, new THREE.Vector3(-Infinity, 0, 0));
          
          this.boundingBoxCorners[0].position.copy(rightFrontBottom);
        }
        
        // Update length control (green) - left back bottom
        if (this.boundingBoxCorners[1]) {
          // Find the vertex with min X, min Y, max Z
          const leftBackBottom = vertices.reduce((best, v) => {
            if (v.z > best.z) return v;
            return best;
          }, new THREE.Vector3(0, 0, -Infinity));
          
          this.boundingBoxCorners[1].position.copy(leftBackBottom);
        }
        
        // Update height control (blue) - left front top
        if (this.boundingBoxCorners[2]) {
          // Find the vertex with min X, max Y, min Z
          const leftFrontTop = vertices.reduce((best, v) => {
            if (v.y > best.y) return v;
            return best;
          }, new THREE.Vector3(0, -Infinity, 0));
          
          this.boundingBoxCorners[2].position.copy(leftFrontTop);
        }
        
        // Update center control (yellow)
        if (this.boundingBoxCorners[3]) {
          this.boundingBoxCorners[3].position.copy(center);
        }
        
        // Update rotation control (magenta)
        if (this.boundingBoxCorners[4]) {
          this.boundingBoxCorners[4].position.set(
            center.x,
            Math.max(...vertices.map(v => v.y)) + 0.5,
            center.z
          );
        }
      }
      
      // Make sure to update onMouseUp to reset edit mode
      private onMouseUp = () => {
        this.selectedCorner = null;
        this.cornerEditMode = CornerEditMode.None;
      }
      
      private initializeNormalizedScale() {
        if (this.boundingBoxEditData) {
          this.initialScale.set(
            this.boundingBoxEditData.dimensionX,
            this.boundingBoxEditData.dimensionY,
            this.boundingBoxEditData.dimensionZ
          );
          
          // Store the normalized aspect ratios
          this.boundingBoxEditData.normalizedRatioX = 1;
          this.boundingBoxEditData.normalizedRatioY = this.initialScale.y / this.initialScale.x;
          this.boundingBoxEditData.normalizedRatioZ = this.initialScale.z / this.initialScale.x;
        }
      }
    
      private removeBoundingBoxCorners() {
        this.boundingBoxCorners.forEach(corner => {
          this.scene.remove(corner);
        });
        this.boundingBoxCorners = [];
        this.selectedCorner = null;
      }
      private createBoundingBoxCorners() {
        // Clear any existing corners
        this.removeBoundingBoxCorners();
      
        // If no bounding box exists or no edit data, return
        if (!this.boundingBoxMesh || !this.boundingBoxEditData) return;
        
        // Initialize normalized scale if not already done
        if (!this.boundingBoxEditData.normalizedRatioX) {
          this.initializeNormalizedScale();
        }
      
        // Get bounding box vertices
        const geometry = this.boundingBoxMesh.geometry;
        const positions = geometry.getAttribute('position');
        
        // Store original corner positions for reference
        this.originalCornerPositions = [];
        for (let i = 0; i < 8; i++) {
          const vertex = new THREE.Vector3(
            positions.getX(i),
            positions.getY(i),
            positions.getZ(i)
          );
          this.originalCornerPositions.push(vertex.clone());
        }
      
        // Create corner markers with different colors based on function
        const cornerGeometry = new THREE.SphereGeometry(0.15);
        
        // Create specialized corner controls
        
        // Width control (X dimension) - red
        const widthCornerMaterial = new THREE.MeshBasicMaterial({ color: this.cornerColors.width });
        const widthCorner = new THREE.Mesh(cornerGeometry, widthCornerMaterial);
        widthCorner.position.copy(this.originalCornerPositions[1]); // Right front bottom corner
        widthCorner.userData = { editMode: CornerEditMode.Width };
        this.scene.add(widthCorner);
        this.boundingBoxCorners.push(widthCorner);
        
        // Length control (Y dimension) - green
        const lengthCornerMaterial = new THREE.MeshBasicMaterial({ color: this.cornerColors.length });
        const lengthCorner = new THREE.Mesh(cornerGeometry, lengthCornerMaterial);
        lengthCorner.position.copy(this.originalCornerPositions[3]); // Left back bottom corner
        lengthCorner.userData = { editMode: CornerEditMode.Length };
        this.scene.add(lengthCorner);
        this.boundingBoxCorners.push(lengthCorner);
        
        // Height control (Z dimension) - blue
        const heightCornerMaterial = new THREE.MeshBasicMaterial({ color: this.cornerColors.height });
        const heightCorner = new THREE.Mesh(cornerGeometry, heightCornerMaterial);
        heightCorner.position.copy(this.originalCornerPositions[4]); // Left front top corner
        heightCorner.userData = { editMode: CornerEditMode.Height };
        this.scene.add(heightCorner);
        this.boundingBoxCorners.push(heightCorner);
        
        // Center control - yellow
        const centerCornerMaterial = new THREE.MeshBasicMaterial({ color: this.cornerColors.center });
        const centerCorner = new THREE.Mesh(cornerGeometry, centerCornerMaterial);
        const center = new THREE.Vector3();
        this.originalCornerPositions.forEach(pos => center.add(pos));
        center.divideScalar(this.originalCornerPositions.length);
        centerCorner.position.copy(center);
        centerCorner.userData = { editMode: CornerEditMode.Center };
        this.scene.add(centerCorner);
        this.boundingBoxCorners.push(centerCorner);
        
        // Rotation control - magenta (placed above the box)
        const rotationCornerMaterial = new THREE.MeshBasicMaterial({ color: this.cornerColors.rotation });
        const rotationCorner = new THREE.Mesh(cornerGeometry, rotationCornerMaterial);
        const topCenter = new THREE.Vector3(
          center.x,
          Math.max(...this.originalCornerPositions.map(p => p.y)) + 0.5, // Place it above the box
          center.z
        );
        rotationCorner.position.copy(topCenter);
        rotationCorner.userData = { editMode: CornerEditMode.Rotation };
        this.scene.add(rotationCorner);
        this.boundingBoxCorners.push(rotationCorner);
        
      }
      

 
      private createBoundingBoxMesh(vertices: number[]) {
        const geometry = new THREE.BufferGeometry();
      
        // Define edges of the bounding box using the flattened vertices
        const edgeIndices = [
          0, 1, 1, 2, 2, 3, 3, 0,  // First face
          4, 5, 5, 6, 6, 7, 7, 4,  // Second face
          0, 4,  // Connecting lines between faces
          1, 5, 
          2, 6, 
          3, 7
        ];
      
        const edgeVertices = edgeIndices.map(index => vertices.slice(index * 3, index * 3 + 3)).flat();
      
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(edgeVertices, 3));
      
        // Create bounding box mesh with edges
        const material = new THREE.LineBasicMaterial({ 
          color: 0xff0000,  // Red color for bounding box
          linewidth: 2
        });
      
        this.boundingBoxMesh = new THREE.LineSegments(geometry, material);
      
        // Add to scene
        this.scene.add(this.boundingBoxMesh);
      }
    

      ngOnDestroy() {
        // Cleanup
        this.trackballControls.dispose();
        this.renderer.dispose();
        
        // Remove existing objects
        this.clearScene();

        // Remove event listeners
        window.removeEventListener('resize', this.onWindowResize);
        window.removeEventListener('keydown', this.onKeyDown);
        this.rendererContainer.nativeElement.removeEventListener('mousedown', this.onMouseDown);
        this.rendererContainer.nativeElement.removeEventListener('mousemove', this.onMouseMove);
        this.rendererContainer.nativeElement.removeEventListener('mouseup', this.onMouseUp);
      }

      private clearScene() {
        // Remove point cloud
        if (this.pointCloud) {
          this.scene.remove(this.pointCloud);
          this.pointCloud = null;
        }

        // Remove GLB model
        if (this.glbModel) {
          this.scene.remove(this.glbModel);
          this.glbModel = null;
        }

        // Remove bounding box
        if (this.boundingBoxMesh) {
          this.scene.remove(this.boundingBoxMesh);
          this.boundingBoxMesh = null;
        }

        // Remove axes helper
        if (this.axesHelper) {
          this.scene.remove(this.axesHelper);
        }
      }

      private animate = () => {
        requestAnimationFrame(this.animate);
        
        // Update controls
        this.trackballControls.update();
        
        // Render scene
        this.renderer.render(this.scene, this.camera);
      }

      onFileUpload(event: Event, type: string){
        const input = event.target as HTMLInputElement;
        if (!input.files || input.files.length === 0) return;

        const file = input.files[0];
        const reader = new FileReader();

        if (type === 'ply') {
          reader.onload = (e) => {
            const arrayBuffer = e.target?.result as ArrayBuffer;
            this.loadPLYFile(arrayBuffer);
          };
        } else if (type === 'glb') {
          reader.onload = (e) => {
            const arrayBuffer = e.target?.result as ArrayBuffer;
            this.loadGLBFile(arrayBuffer);
          };
        } 
        reader.readAsArrayBuffer(file);
      }

      onJSONFileUpload(event: Event) {
        const input = event.target as HTMLInputElement;
        if (!input.files || input.files.length === 0) return;
    
        const file = input.files[0];
        const reader = new FileReader();
    
        reader.onload = (e) => {
          const jsonContent = e.target?.result as string;
          this.loadBoundingBoxFromJSON(jsonContent);
        };
    
        reader.readAsText(file);
      }

      private loadPLYFile(arrayBuffer: ArrayBuffer) {
        // Remove existing point cloud
        if (this.pointCloud) {
          this.scene.remove(this.pointCloud);
        }
      
        // Create PLY loader
        const loader = new PLYLoader();
        const geometry = loader.parse(arrayBuffer);
      
        // Apply coordinate transformation to geometry
        const positions = geometry.getAttribute('position');
        const transformedPositions = new Float32Array(positions.count * 3);
      
        for (let i = 0; i < positions.count; i++) {
          const vertex = new THREE.Vector3(
            positions.getX(i),
            positions.getY(i),
            positions.getZ(i)
          );
      
          transformedPositions[i * 3] = vertex.x;
          transformedPositions[i * 3 + 1] = vertex.y;
          transformedPositions[i * 3 + 2] = vertex.z;
        }
      
        // Replace original positions with transformed positions
        geometry.setAttribute('position', new THREE.BufferAttribute(transformedPositions, 3));
      
        // Prepare color material
        let material: THREE.PointsMaterial;
        
        // Check if geometry has color attribute
        if (geometry.hasAttribute('color')) {
          // Use vertex colors if available
          material = new THREE.PointsMaterial({ 
            size: this.pointSize,
            vertexColors: true
          });
        } else {
          // Fallback to default green color
          material = new THREE.PointsMaterial({ 
            color: 0x00ff00,
            size: this.pointSize
          });
        }
      
        // Create point cloud without centering
        this.pointCloud = new THREE.Points(geometry, material);
      
        // Update point cloud stats
        geometry.computeBoundingBox();
        const boundingBox = geometry.boundingBox;
        if (boundingBox) {
          this.pointCloudStats = {
            points: geometry.attributes['position'].count,
            boundingBox: {
              min: boundingBox.min,
              max: boundingBox.max
            }
          };
        }
      
        // Add to scene at original position
        this.scene.add(this.pointCloud);
      
        // Adjust camera to view the entire point cloud
        this.fitCameraToObject(this.pointCloud);
      }
      
      private loadGLBFile(arrayBuffer: ArrayBuffer) {
        // Remove existing GLB model
        if (this.glbModel) {
          this.scene.remove(this.glbModel);
        }
      
        // Create GLTF loader
        const loader = new GLTFLoader();
      
        // Parse the ArrayBuffer
        loader.parse(arrayBuffer, '', (gltf) => {
          // Store the model without any positioning modifications
          this.glbModel = gltf.scene;
      
          // Traverse meshes to preserve original materials
          this.glbModel.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              // Handle potential array of materials or single material
              const materials = Array.isArray(child.material) ? child.material : [child.material];
              
              child.material = materials.map(material => {
                // Check if it's a standard material that supports color and other properties
                if (material instanceof THREE.MeshStandardMaterial) {
                  const stdMaterial = material as THREE.MeshStandardMaterial;
                  return stdMaterial.clone();
                }
                return material;
              });
      
              // If it was a single material, unwrap from array
              if (materials.length === 1) {
                child.material = child.material[0];
              }
            }
          });
      
          // Add to scene without any positioning modifications
          this.scene.add(this.glbModel);
      
          // Adjust camera to view the entire model
          this.fitCameraToObject(this.glbModel);
        }, 
        // Error handling
        (error) => {
          console.error('Error loading GLB file:', error);
        });
      }

      private loadBoundingBoxFromJSON(jsonContent: string) {
        // Remove existing bounding box
        if (this.boundingBoxMesh) {
          this.scene.remove(this.boundingBoxMesh);
        }
      
        try {
          const data: BoundingBoxData[] = JSON.parse(jsonContent);
          
          if (data.length === 0) {
            console.warn('No bounding box data found in JSON');
            return;
          }
      
          // Use the first bounding box in the file
          const bboxData = data[0];
          
          // Extract vertices from bbox3D_cam
          const bbox3D = bboxData.bbox3D_cam;
          const flatVertices: number[] = [];
          bbox3D.forEach(vertex => {
            flatVertices.push(vertex[0], vertex[1], vertex[2]);
          });
      
          // Compute center
          const centerX = bbox3D.reduce((sum, vertex) => sum + vertex[0], 0) / bbox3D.length;
          const centerY = bbox3D.reduce((sum, vertex) => sum + vertex[1], 0) / bbox3D.length;
          const centerZ = bbox3D.reduce((sum, vertex) => sum + vertex[2], 0) / bbox3D.length;
      
          // Compute dimensions by finding min and max
          const minX = Math.min(...bbox3D.map(v => v[0]));
          const maxX = Math.max(...bbox3D.map(v => v[0]));
          const minY = Math.min(...bbox3D.map(v => v[1]));
          const maxY = Math.max(...bbox3D.map(v => v[1]));
          const minZ = Math.min(...bbox3D.map(v => v[2]));
          const maxZ = Math.max(...bbox3D.map(v => v[2]));
      
          // Store bounding box edit data
          this.boundingBoxEditData = {
            centerX,
            centerY,
            centerZ,
            dimensionX: Math.abs(maxX - minX),
            dimensionY: Math.abs(maxY - minY),
            dimensionZ: Math.abs(maxZ - minZ),
            rotationX: 0,
            rotationY: 0,
            rotationZ: 0,
            originalVertices: flatVertices,
            // Add the missing optional properties
            originalCenter: new THREE.Vector3(centerX, centerY, centerZ),
            originalDimensions: new THREE.Vector3(
              Math.abs(maxX - minX),
              Math.abs(maxY - minY),
              Math.abs(maxZ - minZ)
            ),
            normalizedRatioX: 1, // Default value of 1 for no scaling
            normalizedRatioY: 1, // Default value of 1 for no scaling
            normalizedRatioZ: 1  // Default value of 1 for no scaling
          };
      
          // Create initial bounding box mesh using flat vertices
          this.createBoundingBoxMesh(flatVertices);
        } catch (error) {
          console.error('Error parsing JSON:', error);
        }
      }

      private fitCameraToObject(object: THREE.Points | THREE.Group) {
        const boundingBox = new THREE.Box3().setFromObject(object);
        const size = boundingBox.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        
        // Compute the distance to fit the object
        const fitHeightDistance = maxDim / (2 * Math.atan(Math.PI / 4));
        const fitWidthDistance = fitHeightDistance / this.camera.aspect;
        const distance = 1.5 * Math.max(fitHeightDistance, fitWidthDistance);

        const center = boundingBox.getCenter(new THREE.Vector3());
        
        // Position camera
        this.camera.position.copy(center);
        this.camera.position.z += distance;
        this.camera.lookAt(center);

        // Update trackball controls
        this.trackballControls.target.copy(center);
        this.trackballControls.update();

        // Reposition axes helper to object center
        this.axesHelper.position.copy(center);
      }
}