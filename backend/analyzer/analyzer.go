package analyzer

import (
	"go/ast"
	"go/parser"
	"go/token"
	"go/types"
	"os"
	"path/filepath"
	"strings"
)

// Node represents a package-level component in the data flow graph
type Node struct {
	ID          string            `json:"id"`
	Label       string            `json:"label"`
	Package     string            `json:"package"`
	Functions   []FunctionInfo    `json:"functions"`
	Type        string            `json:"type"` // "entrypoint", "package", "external"
	Position    map[string]float64 `json:"position"`
}

// Edge represents data flow between two components
type Edge struct {
	ID     string `json:"id"`
	Source string `json:"source"`
	Target string `json:"target"`
	Label  string `json:"label"` // function call or data type
}

// FunctionInfo holds metadata about a function within a package
type FunctionInfo struct {
	Name       string   `json:"name"`
	Params     []string `json:"params"`
	Returns    []string `json:"returns"`
	CallsTo    []string `json:"callsTo"`    // packages this function calls into
	DataOps    []string `json:"dataOps"`    // data operations: merge, transform, filter...
}

// Graph is the full data flow graph
type Graph struct {
	Nodes []Node `json:"nodes"`
	Edges []Edge `json:"edges"`
}

type pkgInfo struct {
	name      string
	path      string
	fset      *token.FileSet
	files     []*ast.File
	typeInfo  *types.Info
	functions []FunctionInfo
	imports   map[string]string // alias -> import path
}

// Analyze parses the Go project at rootDir and returns a data flow graph
func Analyze(rootDir string) (*Graph, error) {
	packages, err := loadPackages(rootDir)
	if err != nil {
		return nil, err
	}

	graph := &Graph{}
	nodeMap := map[string]*Node{}
	edgeSet := map[string]bool{}

	// Build nodes from packages
	for pkgPath, pkg := range packages {
		nodeID := sanitizeID(pkgPath)
		nodeType := "package"
		if pkg.name == "main" {
			nodeType = "entrypoint"
		}

		n := &Node{
			ID:        nodeID,
			Label:     pkg.name,
			Package:   pkgPath,
			Functions: pkg.functions,
			Type:      nodeType,
			Position:  map[string]float64{"x": 0, "y": 0},
		}
		nodeMap[pkgPath] = n
		graph.Nodes = append(graph.Nodes, *n)
	}

	// Build edges only between internal (project) packages — skip external deps
	edgeIdx := 0
	for srcPath, pkg := range packages {
		for _, fn := range pkg.functions {
			for _, calledPkg := range fn.CallsTo {
				// skip packages not in the project (external / stdlib)
				if _, exists := nodeMap[calledPkg]; !exists {
					continue
				}

				edgeKey := srcPath + "->" + calledPkg
				if !edgeSet[edgeKey] {
					edgeSet[edgeKey] = true
					graph.Edges = append(graph.Edges, Edge{
						ID:     "e" + string(rune('0'+edgeIdx)),
						Source: sanitizeID(srcPath),
						Target: sanitizeID(calledPkg),
						Label:  fn.Name,
					})
					edgeIdx++
				}
			}
		}
	}

	applyLayout(graph)
	return graph, nil
}

func loadPackages(rootDir string) (map[string]*pkgInfo, error) {
	pkgs := map[string]*pkgInfo{}

	err := filepath.WalkDir(rootDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !d.IsDir() {
			return nil
		}
		// skip hidden dirs and vendor
		base := filepath.Base(path)
		if strings.HasPrefix(base, ".") || base == "vendor" || base == "node_modules" {
			return filepath.SkipDir
		}

		fset := token.NewFileSet()
		pkgsInDir, parseErr := parser.ParseDir(fset, path, nil, parser.ParseComments)
		if parseErr != nil {
			return nil
		}

		for pkgName, astPkg := range pkgsInDir {
			if strings.HasSuffix(pkgName, "_test") {
				continue
			}
			relPath, _ := filepath.Rel(rootDir, path)
			pkgPath := filepath.ToSlash(relPath)
			if pkgPath == "." {
				pkgPath = pkgName
			}

			var files []*ast.File
			for _, f := range astPkg.Files {
				files = append(files, f)
			}

			info := &pkgInfo{
				name:    pkgName,
				path:    pkgPath,
				fset:    fset,
				files:   files,
				imports: map[string]string{},
			}
			info.functions = extractFunctions(files, fset)
			pkgs[pkgPath] = info
		}
		return nil
	})

	return pkgs, err
}

func extractFunctions(files []*ast.File, fset *token.FileSet) []FunctionInfo {
	var fns []FunctionInfo

	for _, file := range files {
		// collect imports for this file
		fileImports := map[string]string{}
		for _, imp := range file.Imports {
			importPath := strings.Trim(imp.Path.Value, `"`)
			alias := lastSegment(importPath)
			if imp.Name != nil {
				alias = imp.Name.Name
			}
			fileImports[alias] = importPath
		}

		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil {
				continue
			}

			info := FunctionInfo{
				Name:    fn.Name.Name,
				Params:  extractFieldTypes(fn.Type.Params),
				Returns: extractFieldTypes(fn.Type.Results),
			}

			// find calls to other packages
			callSet := map[string]bool{}
			ast.Inspect(fn.Body, func(n ast.Node) bool {
				call, ok := n.(*ast.CallExpr)
				if !ok {
					return true
				}
				sel, ok := call.Fun.(*ast.SelectorExpr)
				if !ok {
					return true
				}
				ident, ok := sel.X.(*ast.Ident)
				if !ok {
					return true
				}
				if pkgPath, exists := fileImports[ident.Name]; exists {
					callSet[pkgPath] = true
				}
				return true
			})

			for pkg := range callSet {
				info.CallsTo = append(info.CallsTo, pkg)
			}

			// detect data operations
			info.DataOps = detectDataOps(fn)

			fns = append(fns, info)
		}
	}
	return fns
}

func extractFieldTypes(fields *ast.FieldList) []string {
	if fields == nil {
		return nil
	}
	var types []string
	for _, field := range fields.List {
		t := typeString(field.Type)
		if len(field.Names) == 0 {
			types = append(types, t)
		} else {
			for _, name := range field.Names {
				types = append(types, name.Name+": "+t)
			}
		}
	}
	return types
}

func typeString(expr ast.Expr) string {
	if expr == nil {
		return ""
	}
	switch t := expr.(type) {
	case *ast.Ident:
		return t.Name
	case *ast.StarExpr:
		return "*" + typeString(t.X)
	case *ast.SelectorExpr:
		return typeString(t.X) + "." + t.Sel.Name
	case *ast.ArrayType:
		return "[]" + typeString(t.Elt)
	case *ast.MapType:
		return "map[" + typeString(t.Key) + "]" + typeString(t.Value)
	case *ast.InterfaceType:
		return "interface{}"
	case *ast.ChanType:
		return "chan " + typeString(t.Value)
	case *ast.FuncType:
		return "func"
	case *ast.Ellipsis:
		return "..." + typeString(t.Elt)
	}
	return "unknown"
}

func detectDataOps(fn *ast.FuncDecl) []string {
	ops := map[string]bool{}
	ast.Inspect(fn.Body, func(n ast.Node) bool {
		switch node := n.(type) {
		case *ast.RangeStmt:
			ops["iterate"] = true
		case *ast.IfStmt:
			ops["filter"] = true
		case *ast.AssignStmt:
			if len(node.Rhs) > 0 {
				if _, ok := node.Rhs[0].(*ast.CompositeLit); ok {
					ops["transform"] = true
				}
			}
		case *ast.CallExpr:
			if sel, ok := node.Fun.(*ast.SelectorExpr); ok {
				switch sel.Sel.Name {
				case "Append", "append":
					ops["merge"] = true
				case "Copy", "copy":
					ops["copy"] = true
				}
			}
		}
		return true
	})

	var result []string
	for op := range ops {
		result = append(result, op)
	}
	return result
}

// applyLayout assigns x/y positions using a simple layered layout
func applyLayout(g *Graph) {
	layers := map[string]int{}
	// entrypoint = layer 0
	for i, n := range g.Nodes {
		if n.Type == "entrypoint" {
			layers[n.ID] = 0
			_ = i
		}
	}

	// BFS to assign layers
	changed := true
	for changed {
		changed = false
		for _, e := range g.Edges {
			srcLayer, ok := layers[e.Source]
			if !ok {
				continue
			}
			tgtLayer, exists := layers[e.Target]
			if !exists || tgtLayer < srcLayer+1 {
				layers[e.Target] = srcLayer + 1
				changed = true
			}
		}
	}

	// group by layer
	layerNodes := map[int][]int{}
	for i, n := range g.Nodes {
		l := layers[n.ID]
		layerNodes[l] = append(layerNodes[l], i)
	}

	xSpacing := 250.0
	ySpacing := 150.0
	for layer, indices := range layerNodes {
		for j, idx := range indices {
			g.Nodes[idx].Position["x"] = float64(layer) * xSpacing
			g.Nodes[idx].Position["y"] = float64(j) * ySpacing
		}
	}
}

func sanitizeID(s string) string {
	r := strings.NewReplacer("/", "_", ".", "_", "-", "_", " ", "_")
	return r.Replace(s)
}

func lastSegment(path string) string {
	parts := strings.Split(path, "/")
	return parts[len(parts)-1]
}
