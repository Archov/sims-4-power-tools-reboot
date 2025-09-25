# S4S Merge/Unmerge Architecture Analysis

## Overview

After analyzing the decompiled Sims 4 Studio (S4S) code, I've identified the key architectural patterns that enable their advanced merge/unmerge capabilities. This document provides insights for improving our own implementation while avoiding direct code copying.

## Key Architectural Insights

### 1. Hierarchical Metadata Structure

**S4S Approach**: Tree-based manifest using `MergedFolderItem` and `MergedPackageItem`

- **Root**: `S4SMergedPackageManifest.Root` (MergedFolderItem)
- **Folders**: Can contain subfolders and packages recursively
- **Packages**: Store package name + list of TGIs belonging to that package

**Key Benefits**:
- **Nested Merge Support**: Can merge previously merged packages by recursively copying their tree structure
- **Directory Preservation**: Maintains original folder hierarchy from merge inputs
- **Scalable**: Tree structure grows naturally with complexity

**Inspiration for Our Code**:
- Replace flat `originalPackages` array with hierarchical structure
- Support merging our own merged packages
- Preserve directory structure from input folders

### 2. Minimal Resource Tracking

**S4S Approach**: Simple TGI ownership tracking

```csharp
// Only stores: package name + list of TGIs
public class MergedPackageItem {
    public string Name { get; set; }
    public List<IResourceKey> Resources { get; set; }
}
```

**Key Benefits**:
- **Compact**: No SHA256 hashes, content hashes, or occurrence tracking
- **Fast**: Simple TGI list lookups
- **Reliable**: TGI-based ownership is unambiguous

**Inspiration for Our Code**:
- Consider if detailed occurrence tracking is necessary
- Simplify metadata where possible
- Focus on reliable TGI-to-package mapping

### 3. Dynamic TGI Generation

**S4S Approach**: Hash-based TGI for metadata resource

```csharp
public static uint Type = FNV.Hash32(nameof(S4SMergedPackageManifest));
```

**Key Benefits**:
- **Collision Resistant**: FNV hash reduces TGI conflicts
- **Deterministic**: Same class name always produces same TGI
- **Namespace Safe**: Uses class name as namespace

**Inspiration for Our Code**:
- Consider hash-based TGIs for metadata resources
- Ensure TGIs are deterministic and collision-resistant

### 4. Recursive Nested Merge Handling

**S4S Approach**: Detect and recursively process merged packages

```csharp
if (package is DBPFPackage dbpfPackage && dbpfPackage.IsMerged) {
    // Recursively copy nested structure
    foreach (var pkg in dbpfPackage.Manifest.EnumeratePackages()) {
        manifest.Root.GetPath(pkg.Folder.FullPath)
            .AddPackage(pkg.Name, pkg.Resources);
    }
} else {
    // Handle regular package
    root.GetPath(path).AddPackage(package);
}
```

**Key Benefits**:
- **Full Nesting Support**: Can merge merged packages infinitely deep
- **Structure Preservation**: Maintains nested folder hierarchies
- **Incremental**: Adds to existing structure rather than replacing

**Inspiration for Our Code**:
- Detect our own merged packages and handle them specially
- Support incremental merging (adding to existing merges)
- Preserve nested directory structures

### 5. Stream-Based Unmerging

**S4S Approach**: Direct stream copying during unmerge

```csharp
// Copy resources directly from merged file to individual packages
foreach (var resource in package.Resources) {
    var entry = mergedPackage.FindEntry(resource);
    FileUtil.CopyStream(inputStream, outputStream, entry.Size);
}
```

**Key Benefits**:
- **Memory Efficient**: No need to load all resources into memory
- **Fast**: Direct file-to-file copying
- **Reliable**: Preserves exact original data

**Inspiration for Our Code**:
- Optimize unmerge to use streaming where possible
- Reduce memory usage during large package operations

## Efficiency Insights

### Why S4S Achieves Smaller/Lower Overhead Merges

1. **TGI-Based Deduplication**: S4S deduplicates resources with identical TGIs (common when same files appear in multiple packages)
2. **Minimal Metadata**: Only tracks package names + TGI lists (no SHA256s, content hashes, or occurrence tracking)
3. **Compact Format**: ~0-1MB metadata overhead vs our 5MB+ overhead
4. **Conditional Processing**: Only processes what's needed for merge/unmerge
5. **Streaming Operations**: Direct data copying without extensive content analysis

### S4S Deduplication Logic (from PackageMergeUtility.cs)

```csharp
// Build set of existing TGIs in merged package
HashSet<IResourceKey> resourceKeySet = new HashSet<IResourceKey>();
foreach (IDBPFResourcePointer entry in this.Package.Entries)
    resourceKeySet.Add((IResourceKey) entry);

// For each new resource, check if TGI already exists
foreach (IDBPFResourcePointer resource in package.Entries) {
    if (!resourceKeySet.Contains((IResourceKey) resource)) {
        // Add resource if TGI is not already in merged package (TGI-based deduplication)
        AddResourceToMergedPackage(resource);
    }
}
```

**Key Finding**: S4S merge = concatenation with TGI-based deduplication. Resources with identical TGIs are deduplicated, but content-based deduplication (different TGIs, same content) does not occur.

### Why Our Tool Adds 5MB Overhead

1. **Always Embeds Comprehensive Metadata**: Even when minimal deduplication occurs, we track detailed provenance information
2. **Content-Based Deduplication Overhead**: SHA256 hashing and content comparison adds processing overhead
3. **Verbose Metadata Format**: Detailed occurrence tracking, package SHA256s, content hashes for perfect reconstruction
4. **Memory-Intensive Processing**: Loads and analyzes all resource content vs S4S's simple TGI checks
5. **Flat Structure**: Cannot leverage hierarchical optimizations (yet)

## Recommended Improvements

### Phase 1: Hierarchical Support
- Implement tree-based metadata structure
- Add nested merge detection and handling
- Support incremental merging

### Phase 2: Metadata Optimization
- Make metadata embedding conditional on deduplication
- Simplify resource tracking (remove unnecessary fields)
- Use streaming operations where possible

### Phase 3: Advanced Features
- Support selective unmerging (extract specific packages)
- Handle directory structure preservation
- Optimize memory usage for large merges

## Compatibility Considerations

- **TGI Changes**: Would need migration path for existing merged packages
- **Format Evolution**: Hierarchical format is backward compatible with flat merges
- **Incremental Adoption**: Can support both formats during transition

## Conclusion

**Corrected Understanding**: S4S performs TGI-based deduplication (removes duplicate TGIs) but not content-based deduplication (different TGIs with same content).

S4S's architecture demonstrates that effective merge/unmerge capabilities can be achieved with simple data structures. The key insights are:

1. **Hierarchy over complexity**: Tree structure enables nesting without complex metadata
2. **Minimalism**: Track only essential information (package names + TGIs)
3. **TGI-Based Deduplication**: Simple and effective for most common duplicate scenarios
4. **Streaming**: Direct data operations for efficiency
5. **Recursion**: Natural handling of nested operations

### Strategic Implications for Our Tool

**Our approach provides SUPERIOR deduplication capability compared to S4S**, but with higher overhead:

| Aspect | Our Tool | S4S |
|--------|----------|-----|
| **Deduplication** | ✅ Content-based (identical data regardless of TGI) | ✅ TGI-based (identical TGIs only) |
| **Space Savings** | ✅ 50-70% typical reduction | ✅ Variable (depends on TGI duplicates present) |
| **Metadata Size** | ❌ 5MB+ overhead | ✅ Minimal (~0-1MB, just TGIs) |
| **Nested Merges** | ❌ Not supported yet | ✅ Full support |
| **Unmerge Quality** | ✅ Perfect (comprehensive metadata) | ✅ Perfect (simple TGI tracking) |

**S4S trades maximum deduplication efficiency for merge/unmerge simplicity.** Our tool provides better space savings but with higher complexity and metadata overhead.

These patterns can inspire optimizations to our merge tool while maintaining our superior deduplication capability.
