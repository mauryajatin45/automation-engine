let products = [];
let statuses = {};
let selectedProduct = null;
let currentFilter = 'all';
let searchTimeout = null;
let currentCursor = null;
let hasNextPage = false;

// Temporary AI payload storage (for specs)
let lastAiResponse = null;

// DOM Elements
const searchInput = document.getElementById('search-input');
const filterAll = document.getElementById('filter-all');
const filterPending = document.getElementById('filter-pending');
const filterReviewed = document.getElementById('filter-reviewed');
const productListContainer = document.getElementById('product-list-container');
const btnLoadMore = document.getElementById('btn-load-more');

const noSelectionView = document.getElementById('no-selection-view');
const editorView = document.getElementById('editor-view');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingOverlayText = document.getElementById('loading-overlay-text');

// Product info elements
const pTitleDisplay = document.getElementById('p-title-display');
const pStatus = document.getElementById('p-status');
const pSku = document.getElementById('p-sku');
const pVendor = document.getElementById('p-vendor');

// Column Left: Original Copy Previews
const originalDescPreview = document.getElementById('original-desc-preview');
const originalSeoTitle = document.getElementById('original-seo-title');
const originalSeoDesc = document.getElementById('original-seo-desc');

// Column Right: Form Fields & Editors
const editDescriptionHtml = document.getElementById('edit-description-html');
const editSeoTitle = document.getElementById('edit-seo-title');
const editSeoDesc = document.getElementById('edit-seo-desc');
const editProductType = document.getElementById('edit-product-type');
const editMetaDepartment = document.getElementById('edit-meta-department');
const editMetaMake = document.getElementById('edit-meta-make');
const editMetaModel = document.getElementById('edit-meta-model');
const editMetaSeries = document.getElementById('edit-meta-series');
const editMetaPosition = document.getElementById('edit-meta-position');
const aiGenerationBadge = document.getElementById('ai-generation-badge');
const specsPreviewCard = document.getElementById('specs-preview-card');
const specsListMetafields = document.getElementById('specs-list-metafields');

const seoTitleCounter = document.getElementById('seo-title-counter');
const seoDescCounter = document.getElementById('seo-desc-counter');

// Action Buttons
const btnGenerateAi = document.getElementById('btn-generate-ai');
const btnPublish = document.getElementById('btn-publish');
const btnDiscard = document.getElementById('btn-discard');

// Initialize App
async function init() {
  // Initialize TinyMCE
  tinymce.init({
    selector: '#edit-description-html',
    plugins: 'lists link table code help wordcount',
    toolbar: 'undo redo | blocks fontfamily fontsize | bold italic underline | alignleft aligncenter alignright | bullist numlist outdent indent | table link | code',
    height: 400,
    menubar: false,
    promotion: false
  });
  
  await fetchStatusTracker();
  await fetchProducts();
  setupEventListeners();
}

// Fetch Status Tracker
async function fetchStatusTracker() {
  try {
    const res = await fetch('/api/status');
    statuses = await res.json();
  } catch (err) {
    console.error('Error loading statuses:', err);
  }
}

// Fetch Products List
async function fetchProducts(search = '', append = false) {
  try {
    const url = `/api/products?first=10&search=${encodeURIComponent(search)}${append && currentCursor ? '&after=' + currentCursor : ''}`;
    const res = await fetch(url);
    const data = await res.json();
    
    if (append) {
      products = products.concat(data.products || []);
    } else {
      products = data.products || [];
    }
    
    hasNextPage = data.pageInfo.hasNextPage;
    currentCursor = data.pageInfo.endCursor;
    
    if (hasNextPage) {
      btnLoadMore.style.display = 'block';
    } else {
      btnLoadMore.style.display = 'none';
    }
    
    if (data.counts && !append) {
      filterAll.textContent = `All (${data.counts.all})`;
      filterPending.textContent = `Pending (${data.counts.pending})`;
      filterReviewed.textContent = `Reviewed (${data.counts.reviewed})`;
    }
    
    renderProductList();
  } catch (err) {
    console.error('Error loading products:', err);
  }
}

// Render Products list sidebar
function renderProductList() {
  productListContainer.innerHTML = '';
  
  const filtered = products.filter(p => {
    const isReviewed = p.isReviewed || (statuses[p.id] && statuses[p.id].status === 'Reviewed');
    
    if (currentFilter === 'pending') return !isReviewed;
    if (currentFilter === 'reviewed') return isReviewed;
    return true; // all
  });

  if (filtered.length === 0) {
    productListContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px;">No products found.</div>';
    return;
  }

  filtered.forEach(p => {
    const isReviewed = p.isReviewed || (statuses[p.id] && statuses[p.id].status === 'Reviewed');
    const badgeText = isReviewed ? 'Reviewed' : 'Pending';
    const badgeClass = isReviewed ? 'badge-reviewed' : 'badge-pending';
    
    const div = document.createElement('div');
    div.className = `product-item ${selectedProduct && selectedProduct.id === p.id ? 'active' : ''}`;
    div.dataset.id = p.id;
    
    const thumbUrl = p.imageUrl || 'https://via.placeholder.com/48';
    
    div.innerHTML = `
      <img src="${thumbUrl}" class="product-thumb" alt="">
      <div class="product-item-info">
        <div class="product-item-title">${p.title}</div>
        <span class="badge ${badgeClass}">${badgeText}</span>
      </div>
    `;
    
    div.addEventListener('click', () => selectProduct(p.id));
    productListContainer.appendChild(div);
  });
}

// Select a specific product to load
async function selectProduct(shopifyId) {
  // Extract numerical ID from gid
  const id = shopifyId.replace('gid://shopify/Product/', '');
  showLoader('Loading product details...');
  
  try {
    const res = await fetch(`/api/products/${id}`);
    selectedProduct = await res.json();
    lastAiResponse = null; // Clear old generation data
    
    // UI Layout toggles
    noSelectionView.style.display = 'none';
    editorView.style.display = 'flex';
    aiGenerationBadge.style.display = 'none';
    specsPreviewCard.style.display = 'none';
    
    // Sidebar highlight sync
    document.querySelectorAll('.product-item').forEach(item => {
      item.classList.toggle('active', item.dataset.id === shopifyId);
    });
    
    // Populate header details
    pTitleDisplay.textContent = selectedProduct.title;
    pStatus.textContent = selectedProduct.status;
    pSku.textContent = selectedProduct.sku || 'N/A';
    pVendor.textContent = selectedProduct.vendor || 'N/A';
    
    // Populate Left column (Original Details)
    originalDescPreview.innerHTML = selectedProduct.descriptionHtml || '<p style="font-style: italic; color: var(--text-muted);">No description set.</p>';
    originalSeoTitle.textContent = selectedProduct.seo.title || 'Using default product title';
    originalSeoDesc.textContent = selectedProduct.seo.description || 'Using default product meta description';
    
    // Clear Right column inputs (Editor fields)
    if (tinymce.get('edit-description-html')) {
      tinymce.get('edit-description-html').setContent('');
    }
    editSeoTitle.value = '';
    editSeoDesc.value = '';
    editProductType.value = selectedProduct.productType || '';
    editMetaDepartment.value = '';
    editMetaMake.value = '';
    editMetaModel.value = '';
    editMetaSeries.value = '';
    editMetaPosition.value = '';
    
    // Reset Counters
    updateCounters();
    
    // Check if there is an existing draft
    const draftRes = await fetch(`/api/products/${id}/draft`);
    const draftData = await draftRes.json();
    if (draftData.draft) {
      populateAiData(draftData.draft);
    }
    
  } catch (err) {
    console.error('Error loading product details:', err);
    alert('Failed to load product details.');
  } finally {
    hideLoader();
  }
}

// Live character counters validation
function updateCounters() {
  const titleLen = editSeoTitle.value.length;
  seoTitleCounter.textContent = `${titleLen} / 70`;
  seoTitleCounter.classList.toggle('error', titleLen > 70);
  
  const descLen = editSeoDesc.value.length;
  seoDescCounter.textContent = `${descLen} / 160`;
  seoDescCounter.classList.toggle('error', descLen > 160);
}

// Generate AI Vorschlag
async function generateAiCopy() {
  if (!selectedProduct) return;
  const id = selectedProduct.id.replace('gid://shopify/Product/', '');
  showLoader('Consulting AI Restoration Specialist...');
  
  try {
    const res = await fetch(`/api/products/${id}/generate`, { method: 'POST' });
    const data = await res.json();
    
    if (data.error) {
      alert(`AI error: ${data.error}`);
      return;
    }
    
    lastAiResponse = data; // Cache spec sheets and metafield output JSON
    populateAiData(data);
    
  } catch (err) {
    console.error('Error generating AI copy:', err);
    alert('AI call failed.');
  } finally {
    hideLoader();
  }
}

function populateAiData(data) {
    lastAiResponse = data;
    
    // Populate form fields
    if (tinymce.get('edit-description-html')) {
      tinymce.get('edit-description-html').setContent(data.compiledDescriptionHtml);
    }
    editSeoTitle.value = data.seoTitle;
    editSeoDesc.value = data.seoMetaDescription;
    
    editProductType.value = data.aiData.product_type || selectedProduct.productType;
    editMetaDepartment.value = data.aiData.core_metafields.product_department || '';
    editMetaMake.value = data.aiData.core_metafields.vehicle_make || '';
    editMetaModel.value = data.aiData.core_metafields.vehicle_model || '';
    
    const series = data.aiData.core_metafields.vehicle_series;
    editMetaSeries.value = Array.isArray(series) ? series.join(', ') : series || '';
    
    editMetaPosition.value = data.aiData.core_metafields.fitment_position || '';
    
    // Render visual metadata badge
    aiGenerationBadge.style.display = 'inline-block';
    
    // Display parsed specifications details
    specsPreviewCard.style.display = 'block';
    specsListMetafields.innerHTML = '';
    const specsTable = document.createElement('table');
    specsTable.style.width = '100%';
    specsTable.style.borderCollapse = 'collapse';
    specsTable.style.fontSize = '12px';
    
    for (const [key, val] of Object.entries(data.aiData.specifications)) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td style="font-weight:bold; padding:6px; border:1px solid var(--border-color);">${key}</td>
                      <td style="padding:6px; border:1px solid var(--border-color);">${val}</td>`;
      specsTable.appendChild(tr);
    }
    specsListMetafields.appendChild(specsTable);
    
    // Update live counters
    updateCounters();
}

// Publish modifications to Shopify
async function publishToShopify() {
  if (!selectedProduct) return;
  const id = selectedProduct.id.replace('gid://shopify/Product/', '');
  
  const descriptionHtml = tinymce.get('edit-description-html') ? tinymce.get('edit-description-html').getContent().trim() : '';
  const seoTitle = editSeoTitle.value.trim();
  const seoMetaDescription = editSeoDesc.value.trim();
  const productType = editProductType.value.trim();
  
  if (!descriptionHtml) {
    alert('Please fill out the Description HTML field or generate suggestions first.');
    return;
  }
  
  if (seoTitle.length > 70) {
    if (!confirm('SEO Title exceeds 70 characters. Do you still want to publish?')) return;
  }
  if (seoMetaDescription.length > 160) {
    if (!confirm('Meta Description exceeds 160 characters. Do you still want to publish?')) return;
  }
  
  showLoader('Saving modifications to Shopify...');
  
  // Package metafield payload
  const coreMetafields = {
    vehicle_make: editMetaMake.value.trim(),
    vehicle_model: editMetaModel.value.trim(),
    vehicle_series: editMetaSeries.value.split(',').map(s => s.trim()).filter(s => s),
    product_department: editMetaDepartment.value.trim(),
    fitment_position: editMetaPosition.value.trim()
  };
  
  const specifications = lastAiResponse ? lastAiResponse.aiData.specifications : {};
  
  try {
    const res = await fetch(`/api/products/${id}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        descriptionHtml,
        seoTitle,
        seoMetaDescription,
        productType,
        specifications,
        coreMetafields
      })
    });
    
    const result = await res.json();
    if (result.success) {
      // Re-fetch status tracker
      await fetchStatusTracker();
      
      // Update local array item badge status
      renderProductList();
      
      // Select the product again to show updated Shopify details on left
      await selectProduct(selectedProduct.id);
      
      alert('🎉 Product successfully updated in Shopify!');
    } else {
      alert(`Publish error: ${JSON.stringify(result.errors || result.error)}`);
    }
  } catch (err) {
    console.error('Error publishing:', err);
    alert('Failed to publish changes.');
  } finally {
    hideLoader();
  }
}

// Event Listeners setup
function setupEventListeners() {
  // Search box keyup dynamic search (debounced)
  searchInput.addEventListener('keyup', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      fetchProducts(e.target.value.trim(), false);
    }, 400);
  });
  
  // Load More logic
  btnLoadMore.addEventListener('click', () => {
    fetchProducts(searchInput.value.trim(), true);
  });
  
  // Filters switching
  const filterBtns = [filterAll, filterPending, filterReviewed];
  filterBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      filterBtns.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentFilter = e.target.dataset.filter;
      renderProductList();
    });
  });
  
  // Live counters listener
  editSeoTitle.addEventListener('input', updateCounters);
  editSeoDesc.addEventListener('input', updateCounters);
  
  // Actions
  btnGenerateAi.addEventListener('click', generateAiCopy);
  btnPublish.addEventListener('click', publishToShopify);
  
  btnDiscard.addEventListener('click', () => {
    if (confirm('Discard all AI suggestions and edits for this session?')) {
      selectProduct(selectedProduct.id);
    }
  });
}

// UI loader helpers
function showLoader(text = 'Working...') {
  loadingOverlayText.textContent = text;
  loadingOverlay.style.display = 'flex';
}

function hideLoader() {
  loadingOverlay.style.display = 'none';
}

// Run boot pipeline
init();
