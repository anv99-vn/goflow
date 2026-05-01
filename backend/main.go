package main

import (
	"embed"
	"encoding/json"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"goflow/backend/analyzer"
	"goflow/backend/store"
)

//go:embed dist
var distFS embed.FS

var db *store.Store

func main() {
	dataDir := os.Getenv("GOFLOW_DATA_DIR")
	if dataDir == "" {
		dataDir = "goflow-data"
	}
	var err error
	db, err = store.New(dataDir)
	if err != nil {
		log.Fatal("store init failed:", err)
	}

	mux := http.NewServeMux()

	// Projects
	mux.HandleFunc("GET /api/projects", handleListProjects)
	mux.HandleFunc("POST /api/projects", handleCreateProject)
	mux.HandleFunc("DELETE /api/projects/{id}", handleDeleteProject)

	// Files within a project (upload triggers re-analysis)
	mux.HandleFunc("POST /api/projects/{id}/files", handleAddFiles)
	mux.HandleFunc("DELETE /api/projects/{id}/files/{filename}", handleRemoveFile)

	// Stored graph for a project
	mux.HandleFunc("GET /api/projects/{id}/graph", handleGetGraph)

	// Node positions
	mux.HandleFunc("GET /api/projects/{id}/positions", handleGetPositions)
	mux.HandleFunc("PUT /api/projects/{id}/positions", handleSavePositions)

	// Hidden function nodes
	mux.HandleFunc("GET /api/projects/{id}/hidden", handleGetHidden)
	mux.HandleFunc("PUT /api/projects/{id}/hidden", handleSaveHidden)

	// Custom nodes/edges
	mux.HandleFunc("GET /api/projects/{id}/custom", handleGetCustom)
	mux.HandleFunc("PUT /api/projects/{id}/custom", handleSaveCustom)

	mux.HandleFunc("/api/health", handleHealth)
	mux.Handle("/", spaHandler())

	log.Println("GoFlow running on http://localhost:8080")
	log.Fatal(http.ListenAndServe(":8080", mux))
}

// ── SPA handler ──────────────────────────────────────────────────────────────

func spaHandler() http.Handler {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		log.Fatal(err)
	}
	fileServer := http.FileServer(http.FS(sub))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		if _, err := fs.Stat(sub, path); err != nil {
			r2 := r.Clone(r.Context())
			r2.URL.Path = "/"
			fileServer.ServeHTTP(w, r2)
			return
		}
		fileServer.ServeHTTP(w, r)
	})
}

// ── Response types ────────────────────────────────────────────────────────────

type projectItem struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	FileNames []string `json:"fileNames"`
}

type fileOpResponse struct {
	FileNames []string        `json:"fileNames"`
	Graph     json.RawMessage `json:"graph"`
}

// ── Project handlers ──────────────────────────────────────────────────────────

func handleListProjects(w http.ResponseWriter, r *http.Request) {
	metas, err := db.List()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	items := []projectItem{}
	for _, m := range metas {
		names, _ := db.FileNames(m.ID)
		if names == nil {
			names = []string{}
		}
		items = append(items, projectItem{ID: m.ID, Name: m.Name, FileNames: names})
	}

	jsonOK(w, items)
}

func handleCreateProject(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Name) == "" {
		http.Error(w, "name required", http.StatusBadRequest)
		return
	}

	m, err := db.Create(strings.TrimSpace(req.Name))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	jsonOK(w, projectItem{ID: m.ID, Name: m.Name, FileNames: []string{}})
}

func handleDeleteProject(w http.ResponseWriter, r *http.Request) {
	if err := db.Delete(r.PathValue("id")); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── File handlers ─────────────────────────────────────────────────────────────

func handleAddFiles(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	if err := r.ParseMultipartForm(100 << 20); err != nil {
		http.Error(w, "parse form: "+err.Error(), http.StatusBadRequest)
		return
	}

	headers := r.MultipartForm.File["file"]
	if len(headers) == 0 {
		http.Error(w, "no files provided", http.StatusBadRequest)
		return
	}

	for _, fh := range headers {
		name := filepath.Base(fh.Filename)
		if !strings.HasSuffix(name, ".go") && !strings.HasSuffix(name, ".gd") {
			continue
		}
		f, err := fh.Open()
		if err != nil {
			http.Error(w, "open file: "+err.Error(), http.StatusInternalServerError)
			return
		}
		content, err := io.ReadAll(f)
		f.Close()
		if err != nil {
			http.Error(w, "read file: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if err := db.SaveFile(id, name, content); err != nil {
			http.Error(w, "save file: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}

	graphJSON, err := analyzeProject(id)
	if err != nil {
		http.Error(w, "analysis failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	names, _ := db.FileNames(id)
	if names == nil {
		names = []string{}
	}
	jsonOK(w, fileOpResponse{FileNames: names, Graph: graphJSON})
}

func handleRemoveFile(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	filename := r.PathValue("filename")

	if err := db.RemoveFile(id, filename); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	names, _ := db.FileNames(id)
	if names == nil {
		names = []string{}
	}

	var graphJSON json.RawMessage
	if len(names) > 0 {
		var err error
		graphJSON, err = analyzeProject(id)
		if err != nil {
			http.Error(w, "analysis failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
	} else {
		db.SaveGraph(id, nil)
	}

	jsonOK(w, fileOpResponse{FileNames: names, Graph: graphJSON})
}

// ── Graph handler ─────────────────────────────────────────────────────────────

func handleGetGraph(w http.ResponseWriter, r *http.Request) {
	g, err := db.LoadGraph(r.PathValue("id"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if g == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(g)
}

// ── Position handlers ─────────────────────────────────────────────────────────

func handleGetPositions(w http.ResponseWriter, r *http.Request) {
	pos, err := db.LoadPositions(r.PathValue("id"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, pos)
}

func handleSavePositions(w http.ResponseWriter, r *http.Request) {
	var pos map[string]store.Position
	if err := json.NewDecoder(r.Body).Decode(&pos); err != nil {
		http.Error(w, "bad body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if err := db.SavePositions(r.PathValue("id"), pos); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── Hidden-function handlers ──────────────────────────────────────────────────

func handleGetHidden(w http.ResponseWriter, r *http.Request) {
	ids, err := db.LoadHiddenFuncs(r.PathValue("id"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	jsonOK(w, ids)
}

func handleSaveHidden(w http.ResponseWriter, r *http.Request) {
	var ids []string
	if err := json.NewDecoder(r.Body).Decode(&ids); err != nil {
		http.Error(w, "bad body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if err := db.SaveHiddenFuncs(r.PathValue("id"), ids); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── Custom nodes/edges handlers ───────────────────────────────────────────────

func handleGetCustom(w http.ResponseWriter, r *http.Request) {
	data, err := db.LoadCustom(r.PathValue("id"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

func handleSaveCustom(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if err := db.SaveCustom(r.PathValue("id"), body); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── Health ────────────────────────────────────────────────────────────────────

func handleHealth(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]string{"status": "ok"})
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func jsonOK(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

// analyzeProject runs the appropriate analyzer on a project's files dir,
// saves the resulting graph, and returns the raw JSON.
func analyzeProject(id string) (json.RawMessage, error) {
	filesDir := db.FilesDir(id)

	// Detect language from files present in the dir
	isGDScript := projectIsGDScript(filesDir)

	var g any
	var err error

	if isGDScript {
		g, err = analyzer.AnalyzeGDScript(filesDir)
	} else {
		// Go files must be grouped by package into a temp dir before analysis
		tmpDir, e := os.MkdirTemp("", "goflow-go-*")
		if e != nil {
			return nil, e
		}
		defer os.RemoveAll(tmpDir)

		entries, _ := os.ReadDir(filesDir)
		for _, ent := range entries {
			if ent.IsDir() || !strings.HasSuffix(ent.Name(), ".go") {
				continue
			}
			content, e2 := os.ReadFile(filepath.Join(filesDir, ent.Name()))
			if e2 != nil {
				continue
			}
			pkg := parsePackageName(content)
			if pkg == "" {
				pkg = "main"
			}
			pkgDir := filepath.Join(tmpDir, pkg)
			os.MkdirAll(pkgDir, 0o755)
			os.WriteFile(filepath.Join(pkgDir, ent.Name()), content, 0o644)
		}
		g, err = analyzer.Analyze(tmpDir)
	}
	if err != nil {
		return nil, err
	}

	b, err := json.Marshal(g)
	if err != nil {
		return nil, err
	}
	db.SaveGraph(id, b)
	return b, nil
}

// projectIsGDScript returns true when the project's files dir contains any .gd file.
func projectIsGDScript(filesDir string) bool {
	entries, _ := os.ReadDir(filesDir)
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".gd") {
			return true
		}
	}
	return false
}

// parsePackageName extracts "package X" from Go source without a full parse.
func parsePackageName(src []byte) string {
	for _, line := range strings.SplitN(string(src), "\n", 20) {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "package ") {
			if parts := strings.Fields(line); len(parts) >= 2 {
				return parts[1]
			}
		}
	}
	return ""
}
