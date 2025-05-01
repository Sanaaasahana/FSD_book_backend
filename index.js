<!-- Add this to your category management section -->
<div class="categories-list">
  <% categories.forEach(category => { %>
    <div class="category-item">
      <%= category.name %>
      <button class="delete-category" data-category-id="<%= category.id %>">
        Delete
      </button>
    </div>
  <% }); %>
</div>

<script>
  // Category deletion
  document.querySelectorAll('.delete-category').forEach(button => {
    button.addEventListener('click', async () => {
      const categoryId = button.dataset.categoryId;
      try {
        const response = await fetch('/delete-category', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ categoryId })
        });
        
        const result = await response.json();
        if (result.success) {
          button.closest('.category-item').remove();
        } else {
          alert(result.error || 'Failed to delete category');
        }
      } catch (err) {
        alert('Error deleting category');
      }
    });
  });
</script>
