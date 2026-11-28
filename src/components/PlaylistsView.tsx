import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Edit3,
  FileAudio,
  FileVideo,
  GripVertical,
  Music,
  Play,
  Plus,
  Trash2,
} from 'lucide-react';
import { MediaItem, Playlist } from '../types/media';
import { formatDuration } from '../utils/formatters';

interface PlaylistsViewProps {
  playlists: Playlist[];
  activePlaylistId: string;
  mediaMap: Map<string, MediaItem>;
  allItems: MediaItem[];
  onSelectActivePlaylist: (playlistId: string) => void;
  onCreatePlaylist: (name: string, isBgm?: boolean) => void;
  onRenamePlaylist: (playlistId: string, newName: string) => void;
  onDeletePlaylist: (playlistId: string) => void;
  onReorderPlaylist: (playlistId: string, fromIndex: number, toIndex: number) => void;
  onRemoveItemFromPlaylist: (playlistId: string, index: number) => void;
  onAddItemToPlaylist: (playlistId: string, itemId: string) => void;
  onPlayPlaylistFromIndex: (playlistId: string, index: number) => void;
}

export const PlaylistsView: React.FC<PlaylistsViewProps> = ({
  playlists,
  activePlaylistId,
  mediaMap,
  allItems,
  onSelectActivePlaylist,
  onCreatePlaylist,
  onRenamePlaylist,
  onDeletePlaylist,
  onReorderPlaylist,
  onRemoveItemFromPlaylist,
  onAddItemToPlaylist,
  onPlayPlaylistFromIndex,
}) => {
  const [selectedId, setSelectedId] = useState<string>(activePlaylistId);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newIsBgm, setNewIsBgm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [addMediaId, setAddMediaId] = useState<string>(allItems[0]?.id || '');

  const effectiveAddMediaId = useMemo(
    () =>
      allItems.some((item) => item.id === addMediaId)
        ? addMediaId
        : allItems[0]?.id || '',
    [addMediaId, allItems]
  );

  const selectedPlaylist = useMemo(
    () => playlists.find((p) => p.id === selectedId) || playlists[0],
    [playlists, selectedId]
  );

  const playlistItems = useMemo(() => {
    if (!selectedPlaylist) return [];
    return selectedPlaylist.itemIds.map((id, idx) => ({
      index: idx,
      id,
      item: mediaMap.get(id),
    }));
  }, [mediaMap, selectedPlaylist]);

  const totalDurationSec = useMemo(() => {
    return playlistItems.reduce((sum, entry) => sum + (entry.item?.durationSec || 0), 0);
  }, [playlistItems]);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newPlaylistName.trim();
    if (!trimmed) return;
    onCreatePlaylist(trimmed, newIsBgm);
    setNewPlaylistName('');
    setNewIsBgm(false);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4 p-4 overflow-hidden">
      {/* Left Column: Playlists List */}
      <aside className="w-full lg:w-80 shrink-0 bg-[#111622] border border-white/[0.08] rounded-xl p-4 flex flex-col gap-4 overflow-hidden">
        <div>
          <h2 className="font-display text-sm font-semibold text-white">Service Playlists</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Automatically saved and restored on launch
          </p>
        </div>

        <form onSubmit={handleCreate} className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              placeholder="New playlist name..."
              className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-[#0A0D14] border border-white/[0.09] text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#6366F1]"
            />
            <button
              type="submit"
              className="px-3 py-2 rounded-lg bg-[#5E6AD2] hover:bg-[#4F5BC0] text-white text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create</span>
            </button>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={newIsBgm}
              onChange={(e) => setNewIsBgm(e.target.checked)}
              className="rounded border-white/20 bg-[#0A0D14] text-[#5E6AD2]"
            />
            <span>Mark as Background Music playlist</span>
          </label>
        </form>

        <div className="h-px bg-white/[0.07]" />

        <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1">
          {playlists.map((pl) => {
            const isSelected = selectedPlaylist?.id === pl.id;
            const isActive = activePlaylistId === pl.id;
            return (
              <div
                key={pl.id}
                className={`rounded-lg border p-2.5 transition-colors ${
                  isSelected
                    ? 'bg-[#5E6AD2]/15 border-[#5E6AD2]/45'
                    : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]'
                }`}
              >
                {editingId === pl.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (editingName.trim()) {
                        onRenamePlaylist(pl.id, editingName.trim());
                      }
                      setEditingId(null);
                    }}
                    className="flex gap-2"
                  >
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      autoFocus
                      className="flex-1 min-w-0 px-2 py-1 rounded bg-[#0A0D14] border border-[#6366F1] text-xs text-white"
                    />
                    <button
                      type="submit"
                      className="px-2 py-1 rounded bg-[#5E6AD2] text-white text-xs cursor-pointer"
                    >
                      Save
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedId(pl.id)}
                      className="flex-1 min-w-0 text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        {pl.isBgm && <Music className="w-3.5 h-3.5 text-sky-400 shrink-0" />}
                        <span className="text-xs font-semibold text-slate-100 truncate">
                          {pl.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                        <span className="font-mono-tabular">{pl.itemIds.length} items</span>
                        {isActive && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-indigo-300 font-medium">Active Console</span>
                          </>
                        )}
                      </div>
                    </button>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(pl.id);
                          setEditingName(pl.name);
                        }}
                        title="Rename playlist"
                        className="p-1.5 rounded hover:bg-white/[0.08] text-slate-400 hover:text-white cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>

                      {playlists.length > 1 &&
                        (confirmDeleteId === pl.id ? (
                          <button
                            type="button"
                            onClick={() => {
                              onDeletePlaylist(pl.id);
                              setConfirmDeleteId(null);
                            }}
                            className="px-2 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-medium cursor-pointer"
                          >
                            Confirm
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(pl.id)}
                            title="Delete playlist"
                            className="p-1.5 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      {/* Right Column: Selected Playlist Items & Drag-Drop Reorder */}
      <section className="flex-1 min-w-0 bg-[#111622] border border-white/[0.08] rounded-xl p-4 flex flex-col gap-4 overflow-hidden">
        {selectedPlaylist ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-bold text-white">
                  {selectedPlaylist.name}
                </h2>
                <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                  <span className="font-mono-tabular">{playlistItems.length} items</span>
                  <span aria-hidden="true">·</span>
                  <span>Total Duration:</span>
                  <span className="font-mono-tabular text-slate-200">
                    {formatDuration(totalDurationSec)}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {selectedPlaylist.id !== activePlaylistId && (
                  <button
                    type="button"
                    onClick={() => onSelectActivePlaylist(selectedPlaylist.id)}
                    className="px-3.5 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-slate-100 text-xs font-medium border border-white/[0.08] whitespace-nowrap cursor-pointer"
                  >
                    Set as Active Console Playlist
                  </button>
                )}
                {playlistItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onPlayPlaylistFromIndex(selectedPlaylist.id, 0)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#5E6AD2] hover:bg-[#4F5BC0] text-white text-xs font-semibold whitespace-nowrap cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Play From Start</span>
                  </button>
                )}
              </div>
            </div>

            {/* Quick Add Bar */}
            <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-[#0A0D14] border border-white/[0.07]">
              <select
                value={effectiveAddMediaId}
                onChange={(e) => setAddMediaId(e.target.value)}
                className="flex-1 min-w-[200px] px-3 py-2 rounded-lg bg-[#111622] border border-white/[0.09] text-xs text-slate-100 focus:outline-none focus:border-[#6366F1]"
              >
                {allItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    [{item.kind.toUpperCase()}] {item.name} ({formatDuration(item.durationSec)})
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!effectiveAddMediaId}
                onClick={() =>
                  effectiveAddMediaId && onAddItemToPlaylist(selectedPlaylist.id, effectiveAddMediaId)
                }
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] text-white text-xs font-medium whitespace-nowrap cursor-pointer disabled:opacity-40"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add to Playlist</span>
              </button>
            </div>

            {/* Drag-and-Drop Queue List */}
            <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-white/[0.06]">
              {playlistItems.length === 0 ? (
                <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-center px-6">
                  <p className="font-display text-sm font-semibold text-slate-200">
                    This playlist is empty
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Add media items using the selector above or from the Media Library tab.
                  </p>
                </div>
              ) : (
                playlistItems.map(({ index, id, item }) => (
                  <div
                    key={`${id}-${index}`}
                    draggable
                    onDragStart={() => setDragIndex(index)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragIndex !== null && dragIndex !== index) {
                        onReorderPlaylist(selectedPlaylist.id, dragIndex, index);
                      }
                      setDragIndex(null);
                    }}
                    className={`py-2.5 px-2 flex items-center justify-between gap-3 rounded-lg transition-colors hover:bg-white/[0.03] ${
                      dragIndex === index ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span
                        className="text-slate-500 cursor-grab active:cursor-grabbing shrink-0"
                        title="Drag to reorder"
                      >
                        <GripVertical className="w-4 h-4" />
                      </span>
                      <span className="font-mono-tabular text-xs text-slate-500 w-6 shrink-0">
                        {String(index + 1).padStart(2, '0')}
                      </span>

                      <div className="w-9 h-9 rounded-md bg-[#0A0D14] border border-white/[0.08] flex items-center justify-center shrink-0">
                        {item?.kind === 'video' ? (
                          <FileVideo className="w-4 h-4 text-indigo-400" />
                        ) : (
                          <FileAudio className="w-4 h-4 text-sky-400" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-slate-100 truncate">
                            {item ? item.name : `Unresolved Reference (${id})`}
                          </p>
                          {(!item || item.missing) && (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-400 shrink-0">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              <span>Missing</span>
                            </span>
                          )}
                        </div>
                        {item && (
                          <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                            <span>{item.format}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono-tabular">
                              {formatDuration(item.durationSec)}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="truncate">{item.absolutePath}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => onReorderPlaylist(selectedPlaylist.id, index, index - 1)}
                        className="p-1.5 rounded hover:bg-white/[0.08] text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
                        title="Move up"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={index === playlistItems.length - 1}
                        onClick={() => onReorderPlaylist(selectedPlaylist.id, index, index + 1)}
                        className="p-1.5 rounded hover:bg-white/[0.08] text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
                        title="Move down"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={!item || item.missing}
                        onClick={() => onPlayPlaylistFromIndex(selectedPlaylist.id, index)}
                        className="px-2.5 py-1.5 rounded-lg bg-[#5E6AD2]/20 hover:bg-[#5E6AD2] text-indigo-200 hover:text-white text-xs font-medium cursor-pointer disabled:opacity-30"
                      >
                        Play
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveItemFromPlaylist(selectedPlaylist.id, index)}
                        className="p-1.5 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 cursor-pointer"
                        title="Remove from playlist"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
};
