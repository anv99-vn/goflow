// Package store provides file-based persistence for GoFlow projects.
package store

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// Position is an x/y coordinate for a graph node.
type Position struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// Meta holds the durable metadata for a project.
type Meta struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
}

// Store is a thread-safe, file-based project store.
// Directory layout under BaseDir:
//
//	{id}/
//	  meta.json
//	  files/        ← source files (.go or .gd)
//	  graph.json    ← last analysis result (raw JSON)
//	  positions.json ← saved node positions
type Store struct {
	BaseDir string
	mu      sync.RWMutex
}

// New creates (or opens) a store rooted at dir.
func New(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("store: create base dir: %w", err)
	}
	return &Store{BaseDir: dir}, nil
}

func (s *Store) projectDir(id string) string { return filepath.Join(s.BaseDir, id) }
func (s *Store) filesDir(id string) string   { return filepath.Join(s.BaseDir, id, "files") }
func (s *Store) metaPath(id string) string   { return filepath.Join(s.projectDir(id), "meta.json") }
func (s *Store) graphPath(id string) string  { return filepath.Join(s.projectDir(id), "graph.json") }
func (s *Store) posPath(id string) string    { return filepath.Join(s.projectDir(id), "positions.json") }
func (s *Store) hiddenPath(id string) string { return filepath.Join(s.projectDir(id), "hidden.json") }

// List returns all stored project metas sorted by creation time.
func (s *Store) List() ([]Meta, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	entries, err := os.ReadDir(s.BaseDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var out []Meta
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		m, err := s.readMeta(e.Name())
		if err != nil {
			continue
		}
		out = append(out, m)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out, nil
}

// Create initialises a new project directory and returns its Meta.
func (s *Store) Create(name string) (Meta, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	id := fmt.Sprintf("%d", time.Now().UnixNano())
	m := Meta{ID: id, Name: name, CreatedAt: time.Now()}

	if err := os.MkdirAll(s.filesDir(id), 0o755); err != nil {
		return Meta{}, err
	}
	b, _ := json.Marshal(m)
	if err := os.WriteFile(s.metaPath(id), b, 0o644); err != nil {
		return Meta{}, err
	}
	return m, nil
}

// Delete removes a project and all its data.
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return os.RemoveAll(s.projectDir(id))
}

// GetMeta returns the metadata for a project.
func (s *Store) GetMeta(id string) (Meta, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.readMeta(id)
}

func (s *Store) readMeta(id string) (Meta, error) {
	b, err := os.ReadFile(s.metaPath(id))
	if err != nil {
		return Meta{}, err
	}
	var m Meta
	return m, json.Unmarshal(b, &m)
}

// FileNames returns the list of source file names in a project.
func (s *Store) FileNames(id string) ([]string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.fileNames(id)
}

func (s *Store) fileNames(id string) ([]string, error) {
	entries, err := os.ReadDir(s.filesDir(id))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() {
			names = append(names, e.Name())
		}
	}
	return names, nil
}

// SaveFile writes (or overwrites) a source file in the project's files dir.
func (s *Store) SaveFile(id, name string, content []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(s.filesDir(id), 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(s.filesDir(id), name), content, 0o644)
}

// RemoveFile deletes a single source file from the project.
func (s *Store) RemoveFile(id, name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return os.Remove(filepath.Join(s.filesDir(id), name))
}

// FilesDir returns the absolute path to the project's source-file directory.
func (s *Store) FilesDir(id string) string { return s.filesDir(id) }

// SaveGraph persists the raw analysis-result JSON.
func (s *Store) SaveGraph(id string, graph json.RawMessage) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if graph == nil {
		os.Remove(s.graphPath(id))
		return nil
	}
	return os.WriteFile(s.graphPath(id), graph, 0o644)
}

// LoadGraph returns the last-saved graph JSON, or nil if none exists yet.
func (s *Store) LoadGraph(id string) (json.RawMessage, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	b, err := os.ReadFile(s.graphPath(id))
	if os.IsNotExist(err) {
		return nil, nil
	}
	return b, err
}

// SavePositions persists the map of nodeID → Position.
func (s *Store) SavePositions(id string, pos map[string]Position) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, err := json.Marshal(pos)
	if err != nil {
		return err
	}
	return os.WriteFile(s.posPath(id), b, 0o644)
}

// SaveHiddenFuncs persists the set of hidden function node IDs.
func (s *Store) SaveHiddenFuncs(id string, ids []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, err := json.Marshal(ids)
	if err != nil {
		return err
	}
	return os.WriteFile(s.hiddenPath(id), b, 0o644)
}

// LoadHiddenFuncs returns saved hidden function IDs, or an empty slice if none.
func (s *Store) LoadHiddenFuncs(id string) ([]string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	b, err := os.ReadFile(s.hiddenPath(id))
	if os.IsNotExist(err) {
		return []string{}, nil
	}
	if err != nil {
		return nil, err
	}
	var ids []string
	return ids, json.Unmarshal(b, &ids)
}

// LoadPositions returns saved node positions, or an empty map if none.
func (s *Store) LoadPositions(id string) (map[string]Position, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	b, err := os.ReadFile(s.posPath(id))
	if os.IsNotExist(err) {
		return map[string]Position{}, nil
	}
	if err != nil {
		return nil, err
	}
	var pos map[string]Position
	return pos, json.Unmarshal(b, &pos)
}
