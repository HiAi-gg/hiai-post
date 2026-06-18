<script lang="ts">
  import '../app.css';
  import { AdminSidebar, AdminHeader, ThemeToggle, sidebarStore } from '@hiai/ui';
  import { hiaiPostPlugin } from '$lib/plugin';

  let { data, children } = $props();

  const mode = data?.mode ?? 'standalone';

  const navGroups = hiaiPostPlugin.navGroups;
</script>

<svelte:head>
  <title>HiAi Post</title>
  <meta name="description" content="Social media content planning and publishing" />
</svelte:head>

{#if mode === 'unified'}
  <!-- Unified mode: hiai-admin provides the shell -->
  {@render children()}
{:else}
  <!-- Standalone mode: render own sidebar + header -->
  <div class="flex h-screen overflow-hidden bg-background">
    <AdminSidebar
      navGroups={navGroups}
      collapsed={sidebarStore.collapsed}
      appName="hiai-post"
    />

    <div class="flex flex-1 flex-col overflow-hidden">
      <AdminHeader user={data?.user} onToggleSidebar={() => sidebarStore.toggle()}>
        {#snippet actions()}
          <ThemeToggle />
        {/snippet}
      </AdminHeader>

      <main class="flex-1 overflow-y-auto p-6">
        {@render children()}
      </main>
    </div>
  </div>
{/if}
