// folder-explorer.component.ts
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

interface FolderItem {
  id: number;
  name: string;
  path: string;
  isFolder: boolean;
  children?: FolderItem[];
  isExpanded?: boolean;
  level: number;
  has3dBoxRefined?: boolean;
  is_deleted?: boolean;
  refinedBoxPath?: string;
  annotator?: string;
  annotationDate?: string;
  annotationDuration?: number;
  objectCount?: number;
}

interface PaginationInfo {
  currentPage: number;
  itemsPerPage: number;
  totalItems: number;
  totalPages: number;
}

interface DirectoryStats {
  totalFolders: number;
  refinedFolders: number;
  deletedFolders: number;
  remainingFolders?: number;
  annotatorStats?: { [key: string]: number };
  annotatorAnnotations?: { [key: string]: number };
  annotatorDeletions?: { [key: string]: number };
}

@Component({
  selector: 'app-folder-explorer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './folder_list.component.html',
  styleUrl: './folder_list.component.css'
})

export class FolderExplorerComponent implements OnInit {
  folderStructure: FolderItem[] = [];
  flattenedFolderStructure: FolderItem[] = [];
  paginatedItems: FolderItem[] = [];
  selectedFolderPath: string | null = 'assets';
  apiBaseUrl = environment.apiBaseUrl;

  
  // Add directory stats
  directoryStats: DirectoryStats = {
    totalFolders: 0,
    refinedFolders: 0,
    deletedFolders: 0
  };
  
  pagination: PaginationInfo = {
    currentPage: 1,
    itemsPerPage: 400,
    totalItems: 0,
    totalPages: 0
  };

  // Sorting state
  sortBy: 'name' | 'objectCount' = 'name';

  // Loading state
  isLoadingSorting: boolean = false;
  sortingElapsedTime: number = 0;
  private sortingTimer: any = null;

  constructor(
    private router: Router,
    private http: HttpClient,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    // Load directory statistics
    this.loadDirectoryStats();
    
    // Get page from route query parameters
    this.route.queryParams.subscribe(params => {
      const page = params['page'] ? parseInt(params['page'], 10) : 1;
      this.pagination.currentPage = page;
      this.loadAssetsStructure();
    });
  }

  get remainingFolders(): number {
    return this.directoryStats.totalFolders - this.directoryStats.refinedFolders - this.directoryStats.deletedFolders;
  }

  loadDirectoryStats(): void {
    this.http.get<{
      success: boolean,
      stats: DirectoryStats
    }>(`${this.apiBaseUrl}/api/directory-stats`).subscribe({
      next: (response) => {
        if (response.success) {
          this.directoryStats = response.stats;
        } else {
          console.error('Error loading directory stats:', response);
        }
      },
      error: (error) => {
        console.error('Failed to load directory statistics:', error);
      }
    });
  }

  loadAssetsStructure(forceRefresh: boolean = false): void {
    const refreshParam = forceRefresh ? '&forceRefresh=true' : '';
    this.http.get<{
      success: boolean,
      structure: FolderItem[],
      pagination: PaginationInfo
    }>(`${this.apiBaseUrl}/api/directory?page=${this.pagination.currentPage}${refreshParam}`)
      .subscribe({
        next: (response) => {
          if (response.success && response.structure) {
            this.folderStructure = response.structure;
            this.pagination = response.pagination;
            // Override the currentPage from the response with our route parameter
            // to ensure consistency
            this.pagination.currentPage = this.pagination.currentPage;
            this.applySorting();
            this.flattenFolderStructure();
          } else {
            console.error('Error loading directory structure:', response);
          }
        },
        error: (error) => {
          console.error('Failed to load directory structure:', error);
        }
      });
  }

  applySorting(): void {
    if (this.sortBy === 'name') {
      this.folderStructure.sort((a, b) => a.name.localeCompare(b.name));
    } else if (this.sortBy === 'objectCount') {
      this.folderStructure.sort((a, b) => {
        const countA = a.objectCount || 0;
        const countB = b.objectCount || 0;
        return countA - countB; // Ascending order (fewest objects first)
      });
    }
  }

  onSortChange(): void {
    // Start loading and timer
    const startTime = performance.now();
    this.isLoadingSorting = true;
    this.sortingElapsedTime = 0;

    // Update elapsed time every 10ms for accurate display
    this.sortingTimer = setInterval(() => {
      this.sortingElapsedTime = performance.now() - startTime;
    }, 10);

    // Use requestAnimationFrame to ensure UI updates before sorting
    requestAnimationFrame(() => {
      // Perform sorting
      this.applySorting();
      this.flattenFolderStructure();

      // Force change detection to update the list
      requestAnimationFrame(() => {
        // Stop timer and record final time
        const endTime = performance.now();
        this.sortingElapsedTime = endTime - startTime;

        if (this.sortingTimer) {
          clearInterval(this.sortingTimer);
          this.sortingTimer = null;
        }

        // Hide loading after showing final time for 1 second
        setTimeout(() => {
          this.isLoadingSorting = false;
          this.sortingElapsedTime = 0;
        }, 1000);
      });
    });
  }

  openDashboard(item: FolderItem): void {
    const encodedPath = encodeURIComponent(item.path);
    this.router.navigate(['/dashboard', encodedPath, 'default'], {
      queryParams: { sortBy: this.sortBy }
    });
  }

  openRefinedBox(item: FolderItem): void {
      const encodedPath = encodeURIComponent(item.path);
      this.router.navigate(['/dashboard', encodedPath, 'refined'], {
        queryParams: { sortBy: this.sortBy }
      });
  }

  flattenFolderStructure(): void {
    this.flattenedFolderStructure = [];

    // Get all parent directories for pagination
    const parentDirectories = this.folderStructure.filter(item => item.isFolder);

    // DON'T sort here - use the order from applySorting() instead
    // parentDirectories.sort((a, b) => a.name.localeCompare(b.name));

    // Apply pagination to parent directories
    this.applyPagination(parentDirectories);

    // Flatten the structure for display, starting with paginated parent directories
    const flatten = (items: FolderItem[]) => {
      items.forEach(item => {
        this.flattenedFolderStructure.push(item);

        if (item.isFolder && item.children && item.isExpanded) {
          flatten(item.children);
        }
      });
    };

    flatten(this.paginatedItems);
  }
  
  applyPagination(parentDirectories: FolderItem[]): void {
    const startIndex = (this.pagination.currentPage - 1) * this.pagination.itemsPerPage;
    const endIndex = startIndex + this.pagination.itemsPerPage;
    this.paginatedItems = parentDirectories.slice(startIndex, endIndex);
  }

  toggleFolder(folder: FolderItem): void {
    folder.isExpanded = !folder.isExpanded;
    this.flattenFolderStructure();
  }

  refreshDirectory(): void {
    this.loadDirectoryStats();
    this.loadAssetsStructure(true); // Force cache refresh
  }
  
  changePage(page: number): void {
    if (page < 1 || page > this.pagination.totalPages) {
      return;
    }
    
    // Update the route query parameter
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: page },
      queryParamsHandling: 'merge'
    });
    
    // The page will be reloaded via the route subscription in ngOnInit
  }
  
  nextPage(): void {
    this.changePage(this.pagination.currentPage + 1);
  }
  
  prevPage(): void {
    this.changePage(this.pagination.currentPage - 1);
  }
  
  getAnnotatorStats(): Array<{name: string, count: number, annotations: number, deletions: number}> {
    if (!this.directoryStats.annotatorStats) {
      return [];
    }
    return Object.entries(this.directoryStats.annotatorStats)
      .map(([name, count]) => ({
        name,
        count,
        annotations: this.directoryStats.annotatorAnnotations?.[name] || 0,
        deletions: this.directoryStats.annotatorDeletions?.[name] || 0
      }))
      .sort((a, b) => b.count - a.count);
  }
}