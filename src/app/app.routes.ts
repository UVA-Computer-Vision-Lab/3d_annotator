import { Routes } from '@angular/router';
import { PlyViewer2Component } from './viewer_2/UploadPly_2.component';
import { FolderExplorerComponent } from './project_component/folder_list.component';

export const routes: Routes = [
    {
        path: '',
        component: FolderExplorerComponent
    },
    {
        path: 'dashboard/:path/:type',
        component: PlyViewer2Component
    }
];
