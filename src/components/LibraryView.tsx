import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  FileAudio,
  FilePlus,
  FileVideo,
  FolderPlus,
  FolderSearch,
  ListPlus,
  Play,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { LibraryFolder, MediaItem, Playlist } from '../types/media';
import { formatBytes, formatDuration } from '../utils/formatters';

interface LibraryViewProps {
  items: MediaItem[];
  folders: LibraryFolder[];
  playlists: Playlist[];
  activePlaylistId: string;
  isScanning: boolean;
  scanStatus: string;
  onAddFolderPicker: () => void;
  onAddFiles: (files: FileList | File[]) => void;
  onRefreshLibrary: () => void;
  onRemoveFolder: (folderId: string) => void;
  onToggleFolderAutoScan: (folderId: string) => void;
  onLocateMissingFile: (itemId: string, file: File) => void;
  onPlayMedia: (item: MediaItem) => void;
  onAddToPlaylist: (playlistId: string, itemId: string) => void;
  onDeleteCustomItem: (itemId: string) => void;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  items,
  folders,
  playlists,
  activePlaylistId,
  isScanning,
  scanStatus,
  onAddFolderPicker,
  onAddFiles,
  onRefreshLibrary,
  onRemoveFolder,
  onToggleFolderAutoScan,
  onLocateMissingFile,
  onPlayMedia,
  onAddToPlaylist,
  onDeleteCustomItem,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | 'video' | 'audio'>('all');
  const [selectedFolderId, setSelectedFolderId] = useState<string>('all');
  const [targetPlaylistId, setTargetPlaylistId] = useState<string>(activePlaylistId);
  const effectiveTargetPlaylistId = useMemo(
    () =>
      playlists.some((p) => p.id === targetPlaylistId)
        ? targetPlaylistId
        : playlists[0]?.id || activePlaylistId,
    [activePlaylistId, playlists, targetPlaylistId]
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderFallbackRef = useRef<HTMLInputElement | null>(null);
  const locateInputRef = useRef<HTMLInputElement | null>(null);
  const [locatingItemId, setLocatingItemId] = useState<string | null>(null);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (kindFilter !== 'all' && item.kind !== kindFilter) return false;
      if (selectedFolderId !== 'all' && item.folderId !== selectedFolderId) return false;
      if (
        q &&
        !item.name.toLowerCase().includes(q) &&
        !item.format.toLowerCase().includes(q) &&
        !item.relativePath.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [items, kindFilter, searchQuery, selectedFolderId]);

  const missingCount = useMemo(() => items.filter((i) => i.missing).length, [items]);

  const handleCopyPath = async (item: MediaItem) => {
    try {
      await navigator.clipboard.writeText(item.absolutePath);
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div
      className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4 p-4 overflow-hidden"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          onAddFiles(e.dataTransfer.files);
        }
      }}
    >
      {/* Hidden File Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="video/*,audio/*,.mkv,.avi,.wmv,.flv,.srt,.vtt"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) onAddFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={folderFallbackRef}
        type="file"
        webkitdirectory=""
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) onAddFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={locateInputRef}
        type="file"
        accept="video/*,audio/*,.mkv,.avi,.wmv,.srt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && locatingItemId) {
            onLocateMissingFile(locatingItemId, f);
          }
          setLocatingItemId(null);
          e.target.value = '';
        }}
      />

      {/* Left Column: Directory & Folder Manager */}
      <aside className="w-full lg:w-80 shrink-0 bg-[#111622] border border-white/[0.08] rounded-xl p-4 flex flex-col gap-4 overflow-hidden">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-sm font-semibold text-white">
              GENDEV Media Library
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Source folders play directly without copying files
            </p>
          </div>
          <button
            type="button"
            onClick={onRefreshLibrary}
            disabled={isScanning}
            title="Refresh Library"
            className="p-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onAddFolderPicker}
            className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-[#5E6AD2] hover:bg-[#4F5BC0] text-white text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
          >
            <FolderPlus className="w-4 h-4 shrink-0" />
            <span>Add Folder</span>
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-slate-100 text-xs font-medium border border-white/[0.08] transition-colors whitespace-nowrap cursor-pointer"
          >
            <FilePlus className="w-4 h-4 shrink-0" />
            <span>Browse Files</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => folderFallbackRef.current?.click()}
          className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] text-slate-300 text-xs border border-white/[0.06] transition-colors whitespace-nowrap cursor-pointer"
        >
          <FolderSearch className="w-3.5 h-3.5 shrink-0" />
          <span>Browse Directory (Subfolders)</span>
        </button>

        {scanStatus && (
          <div className="text-xs text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 rounded-lg px-3 py-2">
            {scanStatus}
          </div>
        )}

        <div className="h-px bg-white/[0.07]" />

        <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1">
          <button
            type="button"
            onClick={() => setSelectedFolderId('all')}
            className={`w-full text-left px-3 py-2.5 rounded-lg text-xs transition-colors flex items-center justify-between cursor-pointer ${
              selectedFolderId === 'all'
                ? 'bg-[#5E6AD2]/20 text-white border border-[#5E6AD2]/40'
                : 'text-slate-300 hover:bg-white/[0.04] border border-transparent'
            }`}
          >
            <span className="font-medium truncate">All Directories</span>
            <span className="font-mono-tabular text-slate-400">{items.length}</span>
          </button>

          {folders.map((folder) => {
            const count = items.filter((i) => i.folderId === folder.id).length;
            const active = selectedFolderId === folder.id;
            return (
              <div
                key={folder.id}
                className={`rounded-lg border transition-colors ${
                  active
                    ? 'bg-[#5E6AD2]/15 border-[#5E6AD2]/40'
                    : 'bg-white/[0.02] border-white/[0.05] hover:bg-white/[0.04]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedFolderId(folder.id)}
                  className="w-full text-left px-3 pt-2.5 pb-1.5 flex items-center justify-between gap-2 cursor-pointer"
                >
                  <span className="text-xs font-medium text-slate-100 truncate">
                    {folder.name}
                  </span>
                  <span className="font-mono-tabular text-xs text-slate-400 shrink-0">
                    {count}
                  </span>
                </button>
                <div className="px-3 pb-2.5 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                  <span className="truncate">{folder.pathLabel}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onToggleFolderAutoScan(folder.id)}
                      className={`hover:text-white transition-colors cursor-pointer ${
                        folder.autoScan ? 'text-indigo-300' : 'text-slate-500'
                      }`}
                    >
                      {folder.autoScan ? 'Auto-Scan' : 'Manual'}
                    </button>
                    {folder.sourceType !== 'builtin' && (
                      <button
                        type="button"
                        onClick={() => onRemoveFolder(folder.id)}
                        className="text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                        title="Remove folder from library (files on disk are untouched)"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="text-[11px] text-slate-400 leading-relaxed pt-2 border-t border-white/[0.06]">
          GENDEV never deletes, moves, or modifies your original files on disk.
        </div>
      </aside>

      {/* Main Column: Media Table & Dropzone */}
      <section className="flex-1 min-w-0 bg-[#111622] border border-white/[0.08] rounded-xl p-4 flex flex-col gap-4 overflow-hidden relative">
        {isDragging && (
          <div className="absolute inset-0 z-30 bg-[#0A0D14]/90 border-2 border-dashed border-[#6366F1] rounded-xl flex flex-col items-center justify-center gap-3 pointer-events-none">
            <Upload className="w-10 h-10 text-indigo-400" />
            <p className="font-display text-base font-semibold text-white">
              Drop Video, Audio, or SRT Files to Add to Library
            </p>
            <p className="text-xs text-slate-400">
              Supports MP4, WebM, MOV, MKV, MP3, WAV, FLAC, AAC, OGG, M4A
            </p>
          </div>
        )}

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-[240px]">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search media by filename, format, or path..."
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#0A0D14] border border-white/[0.09] text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#6366F1]"
              />
            </div>

            <div className="flex items-center gap-1 p-1 bg-[#0A0D14] border border-white/[0.08] rounded-lg">
              {(['all', 'video', 'audio'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setKindFilter(tab)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    kindFilter === tab
                      ? 'bg-[#5E6AD2] text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {tab === 'all' ? 'All Media' : tab === 'video' ? 'Video' : 'Audio'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400 whitespace-nowrap">Target Playlist:</label>
            <select
              value={effectiveTargetPlaylistId}
              onChange={(e) => setTargetPlaylistId(e.target.value)}
              className="px-3 py-2 rounded-lg bg-[#0A0D14] border border-white/[0.09] text-xs text-slate-100 focus:outline-none focus:border-[#6366F1]"
            >
              {playlists.map((pl) => (
                <option key={pl.id} value={pl.id}>
                  {pl.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {missingCount > 0 && (
          <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-xs text-amber-200">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                {missingCount} media item(s) could not be accessed (external drive disconnected or
                permission needed). Playlist references are preserved.
              </span>
            </div>
            <button
              type="button"
              onClick={onRefreshLibrary}
              className="px-3 py-1.5 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 font-medium whitespace-nowrap cursor-pointer"
            >
              Re-Scan Drives
            </button>
          </div>
        )}

        {/* Media List */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {filteredItems.length === 0 ? (
            <div className="h-full min-h-[260px] flex flex-col items-center justify-center text-center px-6">
              <FolderSearch className="w-10 h-10 text-slate-600 mb-3" />
              <p className="font-display text-base font-semibold text-slate-200">
                No matching media files
              </p>
              <p className="text-xs text-slate-400 mt-1 max-w-md">
                Drag and drop video or audio files here, or click Add Folder to scan a local drive
                or USB storage directory.
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-4 px-4 py-2 rounded-lg bg-[#5E6AD2] hover:bg-[#4F5BC0] text-white text-xs font-medium cursor-pointer"
              >
                Browse Local Files
              </button>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {filteredItems.map((item) => (
                <div
                  key={item.id}
                  className="py-3 px-2 flex items-center justify-between gap-4 hover:bg-white/[0.03] rounded-lg transition-colors"
                >
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    {/* Thumbnail or Icon */}
                    <div className="w-16 h-10 rounded-md bg-[#0A0D14] border border-white/[0.08] overflow-hidden shrink-0 flex items-center justify-center">
                      {item.thumbnailUrl ? (
                        <img
                          src={item.thumbnailUrl}
                          alt={item.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : item.kind === 'video' ? (
                        <FileVideo className="w-5 h-5 text-indigo-400" />
                      ) : (
                        <FileAudio className="w-5 h-5 text-sky-400" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-slate-100 truncate">
                          {item.name}
                        </p>
                        {item.missing && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-400 shrink-0">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span>Missing File</span>
                          </span>
                        )}
                      </div>
                      <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-xs text-slate-400 mt-0.5">
                        <span>{item.format}</span>
                        {item.resolution && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono-tabular">{item.resolution}</span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular">
                          {item.durationSec > 0 ? formatDuration(item.durationSec) : '--:--'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular">{formatBytes(item.sizeBytes)}</span>
                        <span aria-hidden="true">·</span>
                        <span className="truncate max-w-[260px]" title={item.absolutePath}>
                          {item.absolutePath}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {item.missing ? (
                      <button
                        type="button"
                        onClick={() => {
                          setLocatingItemId(item.id);
                          locateInputRef.current?.click();
                        }}
                        className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-medium whitespace-nowrap cursor-pointer"
                      >
                        Locate File
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onPlayMedia(item)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#5E6AD2] hover:bg-[#4F5BC0] text-white text-xs font-medium whitespace-nowrap cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>Play</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onAddToPlaylist(effectiveTargetPlaylistId, item.id)}
                      title="Add to selected playlist"
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-200 text-xs font-medium whitespace-nowrap cursor-pointer"
                    >
                      <ListPlus className="w-3.5 h-3.5" />
                      <span>Queue</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleCopyPath(item)}
                      title="Copy file path"
                      className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.1] text-slate-300 cursor-pointer"
                    >
                      {copiedId === item.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>

                    {item.sourceType !== 'builtin' && (
                      <button
                        type="button"
                        onClick={() => onDeleteCustomItem(item.id)}
                        title="Remove from GENDEV index (source file remains untouched)"
                        className="p-1.5 rounded-lg bg-white/[0.04] hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
