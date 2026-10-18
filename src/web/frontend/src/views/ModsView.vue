<template>
  <div class="mods-view">
    <ViewHeader :title="t('mods.title')" :server="serverId" :server-state="serverRole">
      <template v-if="serverId" #subtitle>{{ lede }}</template>
      <template v-if="serverId && canRestart" #actions>
        <Button
          class="tap"
          icon="pi pi-refresh"
          :label="t('mods.restart')"
          severity="secondary"
          outlined
          :disabled="!serverStatus || serverActions.isRunning(serverId)"
          :loading="serverActions.isRunning(serverId)"
          @click="restartServer"
        />
      </template>
    </ViewHeader>

    <EmptyState v-if="!serverId" icon="pi pi-server">{{ t("mods.noServer") }}</EmptyState>

    <div v-else class="mods-layout" :class="{ 'has-pending': pendingCount > 0 }">
      <div class="mods-main">
        <section class="summary" :aria-label="t('mods.summary.label')">
          <div class="stat">
            <span class="stat-icon" aria-hidden="true"><i class="pi pi-box" /></span>
            <span class="stat-text">
              <strong class="stat-n">{{ inst.mods.value.length }}</strong>
              <span class="stat-l">{{ t("mods.summary.installed", { count: inst.mods.value.length }) }}</span>
            </span>
          </div>
          <div class="stat">
            <span class="stat-icon ok" aria-hidden="true"><i class="pi pi-check-circle" /></span>
            <span class="stat-text">
              <strong class="stat-n">{{ t("mods.summary.compatible") }}</strong>
              <span class="stat-l">{{ compatibleWith }}</span>
            </span>
          </div>
          <div class="stat">
            <span :class="['stat-icon', pendingCount > 0 ? 'pending' : 'ok']" aria-hidden="true">
              <i :class="pendingCount > 0 ? 'pi pi-clock' : 'pi pi-check'" />
            </span>
            <span class="stat-text">
              <strong class="stat-n">{{ t("mods.summary.pending", { count: pendingCount }) }}</strong>
              <span class="stat-l">{{ pendingCount > 0 ? t("mods.summary.needsRestart") : t("mods.summary.nothingPending") }}</span>
            </span>
          </div>
          <Button
            v-if="canWrite"
            class="tap summary-add"
            icon="pi pi-plus"
            :label="t('mods.summary.add')"
            @click="focusCatalog"
          />
        </section>

        <section
          class="card"
          aria-labelledby="mods-installed-h"
          :aria-busy="inst.loading.value ? 'true' : undefined"
        >
          <div class="card-head">
            <h2 id="mods-installed-h">{{ t("mods.installed.title") }}</h2>
            <span class="card-meta">{{ installedMeta }}</span>
            <span v-if="inst.installed.value" class="cluster">
              <Button
                class="tap"
                icon="pi pi-refresh"
                :label="t('mods.installed.lookForUpdates')"
                size="small"
                severity="secondary"
                outlined
                :loading="inst.checkingUpdates.value"
                @click="inst.refreshUpdates(true)"
              />
              <Button
                v-if="canWrite && inst.updateCount.value > 0"
                class="tap"
                icon="pi pi-arrow-circle-up"
                :label="t('mods.installed.updateAll', { count: inst.updateCount.value })"
                size="small"
                :loading="inst.applyingAll.value"
                @click="applyAll"
              />
            </span>
          </div>

          <div v-if="showCheck" class="check" role="group" aria-labelledby="mods-check-label">
            <div class="check-row">
              <div class="check-field">
                <label id="mods-check-label" for="mods-check-target">{{ t("mods.check.target") }}</label>
                <Select
                  v-if="!compat.useCustom.value"
                  v-model="compat.selected.value"
                  class="check-select tap"
                  :options="versionOptions"
                  option-label="label"
                  option-value="value"
                  label-id="mods-check-target"
                  aria-labelledby="mods-check-label"
                  :loading="compat.loadingVersions.value"
                  :disabled="compat.checkingCompat.value || compat.loadingVersions.value"
                />
                <InputText
                  v-else
                  id="mods-check-target"
                  v-model="compat.customVersion.value"
                  class="check-input tap mono"
                  :placeholder="t('mods.check.customPlaceholder')"
                  :disabled="compat.checkingCompat.value"
                  autocomplete="off"
                  spellcheck="false"
                  @keyup.enter="startCheck()"
                />
              </div>
              <Button
                class="tap"
                :label="compat.checkingCompat.value ? t('mods.check.checking') : checkButtonLabel"
                :loading="compat.checkingCompat.value"
                :disabled="compat.checkingCompat.value || !compat.targetValid.value || inst.mods.value.length === 0"
                @click="startCheck()"
              />
              <Button
                class="tap"
                :label="compat.useCustom.value ? t('mods.check.pickFromList') : t('mods.check.typeVersion')"
                severity="secondary"
                text
                :disabled="compat.checkingCompat.value || (compat.useCustom.value && compat.releases.value.length === 0)"
                @click="compat.useCustom.value = !compat.useCustom.value"
              />
            </div>

            <p v-if="checkedAtText" class="small dim">{{ checkedAtText }}</p>

            <JobBlock
              v-if="compat.checkingCompat.value"
              :title="progressTitle"
              state="running"
              :progress="compat.job.value?.progress ?? null"
              :heading-level="3"
            >
              <p>{{ t("mods.check.runningNote", { version: checkVersionShown }) }}</p>
            </JobBlock>

            <JobBlock
              v-else-if="checkFailed"
              :title="t('mods.check.failedTitle', { version: checkVersionShown })"
              state="failed"
              :heading-level="3"
            >
              <p class="failure">{{ failureText }}</p>
              <template #actions>
                <Button class="tap" :label="t('mods.check.again')" size="small" @click="startCheck(true)" />
                <Button
                  class="tap"
                  :label="t('mods.check.close')"
                  size="small"
                  severity="secondary"
                  text
                  @click="closeResults"
                />
                <span class="small dim nothing-changed">{{ t("mods.check.nothingChanged") }}</span>
              </template>
            </JobBlock>

            <InlineBanner v-else-if="checkNotice" tone="warn">{{ checkNotice }}</InlineBanner>

            <p v-if="compat.emptyResult.value" class="small dim">{{ t("mods.check.emptyResult") }}</p>

            <template v-if="compat.hasResult.value && !compat.emptyResult.value">
              <InlineBanner v-if="compat.stale.value" tone="warn" :title="t('mods.check.staleTitle')">
                {{ t("mods.check.staleText") }}
                <template #actions>
                  <Button class="tap" :label="t('mods.check.again')" size="small" outlined @click="startCheck(true)" />
                </template>
              </InlineBanner>
              <InlineBanner
                v-else
                :tone="blockerCount > 0 ? 'warn' : 'info'"
                :title="blockerCount > 0 ? t('mods.check.blockedTitle') : t('mods.check.readyTitle')"
              >
                {{ verdictText }}
                <template v-if="blockerCount > 0" #actions>
                  <Button
                    class="tap"
                    icon="pi pi-copy"
                    :label="t('mods.check.copyBlockers')"
                    size="small"
                    severity="secondary"
                    outlined
                    @click="copyBlockers"
                  />
                </template>
              </InlineBanner>

              <div class="check-results">
                <div class="minimeter">
                  <div class="metric metric-ready">
                    <span class="metric-n">{{ summary.available }}</span>
                    <span class="metric-l">{{ t("mods.check.metricReady") }}</span>
                  </div>
                  <div class="metric metric-missing">
                    <span class="metric-n">{{ summary.unavailable }}</span>
                    <span class="metric-l">{{ t("mods.check.metricMissing") }}</span>
                  </div>
                  <div class="metric metric-unknown">
                    <span class="metric-n">{{ summary.unknown }}</span>
                    <span class="metric-l">{{ t("mods.check.metricUnknown") }}</span>
                  </div>
                </div>
                <div v-if="blockerRows.length" class="blockers">
                  <span id="mods-blockers-l" class="caps">{{ t("mods.check.blocking") }}</span>
                  <ul class="iconstrip" aria-labelledby="mods-blockers-l">
                    <li v-for="row in blockerRows.slice(0, BLOCKER_ICONS)" :key="row.slug">
                      <ModIcon :name="nameOf(row)" :slug="row.slug" :src="iconOf(row.slug, row.iconUrl)" :size="32" />
                    </li>
                    <li v-if="blockerRows.length > BLOCKER_ICONS" class="more">
                      {{ t("mods.check.more", { count: blockerRows.length - BLOCKER_ICONS }) }}
                    </li>
                  </ul>
                </div>
              </div>
            </template>
          </div>

          <template v-if="compat.checkingCompat.value">
            <div class="subhead">
              <h3>{{ t("mods.check.progressTitle") }}</h3>
              <span class="card-meta">{{ t("mods.check.progressMeta") }}</span>
            </div>
            <ResponsiveTable
              stack-below="narrow"
              :columns="checkColumns"
              :rows="progressRows"
              :caption="t('mods.check.progressCaption')"
              :row-key="(r: CheckRow) => r.slug"
            >
              <template #cell-mod="{ row }">
                <span class="modcell">
                  <ModIcon :name="row.name" :slug="row.slug" :src="row.iconUrl" :size="32" decorative />
                  <span class="name">{{ row.name }}</span>
                </span>
              </template>
              <template #cell-installed="{ row }"><span class="mono">{{ row.installedVersion }}</span></template>
              <template #cell-at="{ row }">
                <StatusChip v-if="row.result" :state="CHIP[row.result.availability].role" :label="t(CHIP[row.result.availability].label)" />
                <StatusChip v-else state="unknown" :label="t('mods.check.waiting')" />
              </template>
              <template #cell-detail="{ row }">
                <span class="small dim">{{ row.result ? detailOf(row.result) : t("mods.check.detailQueued") }}</span>
              </template>
            </ResponsiveTable>
          </template>

          <template v-else-if="compat.hasResult.value && !compat.emptyResult.value">
            <div class="subhead">
              <h3>{{ t("mods.check.resultsTitle", { version: checkVersionShown }) }}</h3>
              <span class="card-meta">{{ t("mods.check.resultsOrder") }}</span>
              <Button
                class="tap"
                icon="pi pi-arrow-left"
                :label="t('mods.check.close')"
                size="small"
                severity="secondary"
                text
                @click="closeResults"
              />
            </div>
            <div class="toolbar" role="group" :aria-label="t('mods.check.filterLabel')">
              <button
                v-for="chip in resultFilters"
                :key="chip.key"
                type="button"
                :class="['chip', 'tap', { on: compat.filter.value === chip.key }]"
                :aria-pressed="compat.filter.value === chip.key"
                @click="compat.filter.value = chip.key"
              >
                {{ chip.label }} <span class="chip-n">{{ chip.count }}</span>
              </button>
            </div>
            <ResponsiveTable
              stack-below="narrow"
              v-if="visibleResults.length"
              :columns="resultColumns"
              :rows="visibleResults"
              :caption="t('mods.check.caption', { version: checkVersionShown })"
              :row-key="(r: CheckRow) => r.slug"
              :actions-label="t('mods.installed.actions')"
              :actions-label-visible="false"
            >
              <template #cell-mod="{ row }">
                <span class="modcell">
                  <ModIcon :name="row.name" :slug="row.slug" :src="row.iconUrl" :size="32" decorative />
                  <span class="name">{{ row.name }}</span>
                </span>
              </template>
              <template #cell-installed="{ row }"><span class="mono">{{ row.installedVersion }}</span></template>
              <template #cell-at="{ row }">
                <StatusChip
                  v-if="row.result"
                  :state="CHIP[row.result.availability].role"
                  :label="t(CHIP[row.result.availability].label)"
                />
              </template>
              <template #cell-detail="{ row }">
                <span class="small dim detail">{{ row.result ? detailOf(row.result) : "" }}</span>
              </template>
              <template #actions="{ row }">
                <a
                  v-if="row.result && row.result.availability !== 'available'"
                  class="link-btn tap"
                  :href="modrinthUrl(row.slug)"
                  target="_blank"
                  rel="noopener noreferrer"
                  :aria-label="t('mods.check.openProjectNamed', { name: row.name })"
                >{{ t("mods.check.openProject") }}</a>
              </template>
            </ResponsiveTable>
            <p v-else class="none-in-filter small dim">{{ t("mods.check.noneInFilter") }}</p>
            <div class="foot">
              <span class="foot-count" aria-live="polite">
                {{ t("mods.check.showing", { shown: visibleResults.length, total: allResults.length }) }}
              </span>
            </div>
          </template>

          <template v-else>
            <div v-if="inst.loading.value && !inst.installed.value" class="skeleton" role="status">
              <span class="sr-only">{{ t("mods.installed.loading", { server: serverId }) }}</span>
              <span v-for="n in 5" :key="n" class="sk-row" aria-hidden="true">
                <span class="sk-tile" />
                <span class="sk-lines"><span /><span /></span>
              </span>
            </div>

            <InlineError
              v-else-if="inst.loadError.value && !inst.installed.value"
              :title="t('mods.installed.loadFailed')"
              :recovery="t('mods.installed.loadFailedRecovery', { server: serverId })"
              :detail="loadErrorDetail"
              :retry-label="t('mods.reload')"
              :busy="inst.loading.value"
              @retry="reload"
            />

            <EmptyState
              v-else-if="inst.installed.value && inst.mods.value.length === 0"
              icon="pi pi-box"
              :title="t('mods.installed.emptyTitle', { server: serverId })"
            >
              {{ t("mods.installed.emptyText") }}
              <template v-if="canWrite" #action>
                <Button class="tap" icon="pi pi-search" :label="t('mods.installed.searchModrinth')" @click="focusCatalog" />
              </template>
            </EmptyState>

            <template v-else-if="inst.installed.value">
              <div class="notices">
                <StaleBanner v-if="inst.installed.value.stale" :stale="inst.installed.value.stale">
                  {{ t("mods.installed.staleText", { age: relativeAge(inst.installed.value.stale.asOf), server: serverId }) }}
                  <template #actions>
                    <Button class="tap" :label="t('mods.reload')" size="small" outlined :loading="inst.loading.value" @click="reload" />
                  </template>
                </StaleBanner>
                <InlineBanner v-if="inst.loadError.value" tone="warn" :title="t('mods.installed.reloadFailed')">
                  {{ t("mods.installed.reloadFailedText", { server: serverId, message: inst.loadError.value.message || String(inst.loadError.value.status ?? "") }) }}
                  <template #actions>
                    <Button class="tap" :label="t('mods.reload')" size="small" outlined :loading="inst.loading.value" @click="reload" />
                  </template>
                </InlineBanner>
                <InlineBanner v-if="inst.updatesError.value" tone="warn" :title="t('mods.installed.updatesFailed')">
                  {{ t("mods.installed.updatesFailedText", { message: inst.updatesError.value }) }}
                  <template #actions>
                    <Button
                      class="tap"
                      :label="t('mods.installed.lookForUpdates')"
                      size="small"
                      outlined
                      :loading="inst.checkingUpdates.value"
                      @click="inst.refreshUpdates(true)"
                    />
                  </template>
                </InlineBanner>
              </div>

              <div class="toolbar">
                <span class="search">
                  <i class="pi pi-search" aria-hidden="true" />
                  <label class="sr-only" for="mods-installed-q">{{ t("mods.installed.search") }}</label>
                  <InputText
                    id="mods-installed-q"
                    v-model="installedQuery"
                    type="search"
                    class="tap"
                    :placeholder="t('mods.installed.searchPlaceholder', { count: inst.mods.value.length })"
                  />
                </span>
                <Select
                  v-model="statusFilter"
                  class="tap filter-select"
                  :options="statusOptions"
                  option-label="label"
                  option-value="value"
                  :aria-label="t('mods.installed.filterStatus')"
                />
                <Select
                  v-model="installedSort"
                  class="tap filter-select"
                  :options="installedSortOptions"
                  option-label="label"
                  option-value="value"
                  :aria-label="t('mods.installed.sortLabel')"
                />
              </div>

              <div v-if="canWrite && selected.size > 0" class="bulk" role="group" :aria-label="t('mods.bulk.label')">
                <span class="bulk-count" aria-live="polite">{{ t("mods.bulk.selected", { count: selected.size }) }}</span>
                <span class="cluster">
                  <Button
                    class="tap"
                    :label="t('mods.installed.disable')"
                    size="small"
                    severity="secondary"
                    outlined
                    :disabled="bulkRunning"
                    @click="bulkDisable"
                  />
                  <Button
                    class="tap"
                    :label="t('mods.installed.remove')"
                    icon="pi pi-trash"
                    size="small"
                    severity="danger"
                    outlined
                    :disabled="bulkRunning"
                    @click="bulkRemove"
                  />
                  <Button
                    class="tap"
                    :label="t('mods.bulk.clear')"
                    size="small"
                    severity="secondary"
                    text
                    :disabled="bulkRunning"
                    @click="selected.clear()"
                  />
                </span>
              </div>

              <ResponsiveTable
                stack-below="narrow"
                v-if="pagedInstalled.length"
                :columns="installedColumns"
                :rows="pagedInstalled"
                :caption="t('mods.installed.caption', { server: serverId })"
                :row-key="(m: InstalledMod) => m.slug"
                :busy="(m: InstalledMod) => inst.isBusy(m.slug)"
                :actions-label="t('mods.installed.actions')"
                :actions-label-visible="false"
              >
                <template v-if="canWrite" #select-head>
                  <Checkbox
                    binary
                    :model-value="allPageSelected"
                    :aria-label="t('mods.bulk.selectPage')"
                    @update:model-value="togglePage"
                  />
                </template>
                <template v-if="canWrite" #select="{ row }">
                  <Checkbox
                    binary
                    :model-value="selected.has(row.slug)"
                    :aria-label="t('mods.bulk.selectNamed', { name: nameOf(row) })"
                    @update:model-value="toggleSelected(row.slug)"
                  />
                </template>
                <template #cell-mod="{ row }">
                  <span :class="['modcell', { off: row.enabled === false }]">
                    <ModIcon :name="nameOf(row)" :slug="row.slug" :src="row.iconUrl" :size="36" decorative />
                    <span class="modcell-text">
                      <span class="name">{{ nameOf(row) }}</span>
                      <span v-if="row.filename" class="sub mono" :title="row.filename">{{ row.filename }}</span>
                    </span>
                  </span>
                </template>
                <template #cell-version="{ row }">
                  <span class="mono version">{{ row.versionId ?? "" }}</span>
                </template>
                <template #cell-status="{ row }">
                  <StatusChip v-bind="statusOf(row)" />
                </template>
                <template #actions="{ row, busy }">
                  <span v-if="busy" class="row-busy" role="status">
                    {{ inst.busyLabel(row.slug) }}. {{ t("mods.installed.rowBusyNote") }}
                  </span>
                  <span v-else class="cluster row-actions">
                    <Button
                      v-if="canWrite && inst.hasUpdate(row.slug)"
                      class="tap"
                      :label="t('mods.installed.update')"
                      size="small"
                      :aria-label="t('mods.installed.updateNamed', { name: nameOf(row) })"
                      :disabled="inst.isLocked(row.slug)"
                      @click="act(row, 'update')"
                    />
                    <Button
                      v-if="canWrite"
                      class="tap"
                      :label="row.enabled === false ? t('mods.installed.enable') : t('mods.installed.disable')"
                      size="small"
                      severity="secondary"
                      outlined
                      :aria-label="
                        row.enabled === false
                          ? t('mods.installed.enableNamed', { name: nameOf(row) })
                          : t('mods.installed.disableNamed', { name: nameOf(row) })
                      "
                      :disabled="inst.isLocked(row.slug)"
                      @click="act(row, row.enabled === false ? 'enable' : 'disable')"
                    />
                    <a
                      class="icon-link tap"
                      :href="modrinthUrl(row.slug)"
                      target="_blank"
                      rel="noopener noreferrer"
                      :aria-label="t('mods.installed.openNamed', { name: nameOf(row) })"
                      :title="t('mods.installed.openModrinth')"
                    ><i class="pi pi-external-link" aria-hidden="true" /></a>
                    <Button
                      v-if="canWrite"
                      class="tap"
                      :label="t('mods.installed.remove')"
                      icon="pi pi-trash"
                      size="small"
                      severity="danger"
                      outlined
                      :aria-label="t('mods.installed.removeNamed', { name: nameOf(row) })"
                      :disabled="inst.isLocked(row.slug)"
                      @click="confirmRemove(row)"
                    />
                  </span>
                </template>
              </ResponsiveTable>
              <p v-else class="none-in-filter small dim">{{ t("mods.installed.noMatch") }}</p>

              <div class="foot">
                <span class="foot-count" aria-live="polite">
                  {{ t("mods.installed.showingRange", { from: pageFrom, to: pageTo, total: visibleInstalled.length }) }}
                </span>
                <nav v-if="installedPages > 1" class="pager" :aria-label="t('mods.installed.pagination')">
                  <button type="button" class="pg tap" :disabled="installedPage === 1" :aria-label="t('mods.catalog.previousPage')" @click="installedPage--">
                    <i class="pi pi-angle-left" aria-hidden="true" />
                  </button>
                  <button
                    v-for="n in installedPages"
                    :key="n"
                    type="button"
                    :class="['pg', 'tap', { on: n === installedPage }]"
                    :aria-current="n === installedPage ? 'page' : undefined"
                    @click="installedPage = n"
                  >{{ n }}</button>
                  <button type="button" class="pg tap" :disabled="installedPage === installedPages" :aria-label="t('mods.catalog.nextPage')" @click="installedPage++">
                    <i class="pi pi-angle-right" aria-hidden="true" />
                  </button>
                </nav>
              </div>
            </template>
          </template>
        </section>
      </div>

      <div class="mods-catalog">
        <section class="card" aria-labelledby="mods-catalog-h" :aria-busy="searching ? 'true' : undefined">
          <div class="card-head">
            <h2 id="mods-catalog-h">{{ t("mods.catalog.title") }}</h2>
            <span class="card-meta">{{ catalogMeta }}</span>
          </div>
          <p class="catalog-lede">{{ t("mods.catalog.lede") }}</p>
          <div class="toolbar catalog-tools">
            <span class="search">
              <i class="pi pi-search" aria-hidden="true" />
              <label class="sr-only" for="mods-catalog-q">{{ t("mods.catalog.search") }}</label>
              <InputText
                id="mods-catalog-q"
                ref="catalogSearch"
                v-model="query"
                type="search"
                class="tap"
                :placeholder="t('mods.catalog.searchPlaceholder')"
                @input="onQueryInput"
              />
            </span>
            <button
              type="button"
              :class="['chip', 'tap', { on: compatible }]"
              :aria-pressed="compatible"
              @click="toggleCompatible"
            >
              {{ compatibleLabel }}
            </button>
            <button
              type="button"
              :class="['chip', 'tap', { on: hideClientOnly }]"
              :aria-pressed="hideClientOnly"
              @click="toggleClientOnly"
            >
              {{ t("mods.catalog.hideClientOnly") }}
            </button>
            <span class="sort">
              <span id="mods-sort-l" class="small dim">{{ t("mods.catalog.sort") }}</span>
              <Select
                v-model="sort"
                class="tap"
                :options="sortOptions"
                option-label="label"
                option-value="value"
                label-id="mods-sort"
                aria-labelledby="mods-sort-l"
                @update:model-value="resetSearch"
              />
            </span>
          </div>

          <div v-if="(searching || !searched) && results.length === 0" class="skeleton" role="status">
            <span class="sr-only">{{ t("mods.catalog.loading") }}</span>
            <span v-for="n in 3" :key="n" class="sk-row" aria-hidden="true">
              <span class="sk-tile" />
              <span class="sk-lines"><span /><span /></span>
            </span>
          </div>

          <InlineError
            v-else-if="searchError"
            :title="t('mods.catalog.failed')"
            :recovery="t('mods.catalog.failedRecovery')"
            :detail="searchError"
            :busy="searching"
            @retry="runSearch"
          />

          <p v-else-if="results.length === 0" class="none-in-filter small dim">{{ t("mods.catalog.empty") }}</p>

          <template v-else>
            <ul class="cat">
              <li v-for="hit in results" :key="hit.projectId || hit.slug" class="cat-item">
                <div class="cat-row">
                  <ModIcon :name="hit.title || hit.slug" :slug="hit.slug" :src="hit.iconUrl ?? ''" :size="48" decorative />
                  <div class="cat-body">
                    <div class="cat-title">
                      <a :href="hit.pageUrl" target="_blank" rel="noopener noreferrer">{{ hit.title || hit.slug }}</a>
                      <span v-if="hit.author" class="cat-by">{{ t("mods.catalog.by", { author: hit.author }) }}</span>
                    </div>
                    <p class="cat-desc">{{ hit.description }}</p>
                    <div class="cat-meta">
                      <span class="tag">{{ t(ENVIRONMENT_LABEL[hit.environment] ?? ENVIRONMENT_LABEL.unknown) }}</span>
                      <span>{{ t("mods.catalog.downloads", { count: compact(hit.downloads) }) }}</span>
                    </div>
                  </div>
                  <Button
                    v-if="hit.installed"
                    class="tap cat-action"
                    :label="t('mods.catalog.installed')"
                    size="small"
                    severity="secondary"
                    outlined
                    disabled
                  />
                  <Button
                    v-else-if="canWrite"
                    class="tap cat-action"
                    :label="installs.isBusy(hit.slug) ? installs.busyLabel(hit.slug) : t('mods.catalog.add')"
                    :icon="openSlug === hit.slug ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
                    icon-pos="right"
                    size="small"
                    severity="secondary"
                    outlined
                    :loading="installs.isBusy(hit.slug)"
                    :aria-expanded="openSlug === hit.slug"
                    :aria-controls="pickerId(hit.slug)"
                    :aria-label="t('mods.catalog.addNamed', { name: hit.title || hit.slug })"
                    @click="toggleVersions(hit)"
                  />
                </div>

                <div v-if="openSlug === hit.slug" :id="pickerId(hit.slug)" class="picker">
                  <div class="picker-head">
                    <span class="picker-title">
                      <ModIcon :name="hit.title || hit.slug" :slug="hit.slug" :src="hit.iconUrl ?? ''" :size="24" decorative />
                      <span class="caps">{{ t("mods.catalog.chooseVersion") }}</span>
                    </span>
                    <Button
                      class="tap"
                      :label="t('mods.catalog.installLatest')"
                      :aria-label="t('mods.catalog.installLatestNamed', { name: hit.title || hit.slug })"
                      size="small"
                      :disabled="installs.isLocked(hit.slug)"
                      @click="install(hit)"
                    />
                  </div>
                  <p v-if="loadingDetail" class="small dim" role="status">{{ t("mods.catalog.loadingVersions") }}</p>
                  <InlineError
                    v-else-if="detailError"
                    :title="t('mods.catalog.versionsFailed')"
                    :detail="detailError"
                    :heading-level="4"
                    @retry="loadDetail(hit)"
                  />
                  <template v-else-if="detail">
                    <p v-if="detail.versions.length === 0" class="small dim">{{ t("mods.catalog.noVersions") }}</p>
                    <div v-for="v in detail.versions.slice(0, VERSIONS_SHOWN)" :key="v.id" class="vrow">
                      <div class="vinfo">
                        <strong class="mono">{{ v.versionNumber }}</strong>
                        <span class="vmeta">{{ versionMeta(v) }}</span>
                      </div>
                      <span class="cluster">
                        <span :class="['tag', { 'tag-beta': v.versionType && v.versionType !== 'release' }]">{{ versionTypeLabel(v.versionType) }}</span>
                        <Button
                          class="tap"
                          :label="t('mods.catalog.install')"
                          size="small"
                          severity="secondary"
                          outlined
                          :aria-label="t('mods.catalog.installNamed', { name: hit.title || hit.slug, version: v.versionNumber })"
                          :disabled="installs.isLocked(hit.slug)"
                          @click="install(hit, v)"
                        />
                      </span>
                    </div>
                  </template>
                </div>
              </li>
            </ul>
            <div class="foot">
              <span class="foot-count">{{ t("mods.catalog.results", { count: total.toLocaleString("en") }) }}</span>
              <nav v-if="total > PAGE" class="pager" :aria-label="t('mods.catalog.pagination')">
                <button type="button" class="pg tap" :disabled="page === 1 || searching" :aria-label="t('mods.catalog.previousPage')" @click="prevPage">
                  <i class="pi pi-angle-left" aria-hidden="true" />
                </button>
                <template v-for="(item, i) in pageItems" :key="`${item}-${i}`">
                  <span v-if="item === 'gap'" class="pg-gap" aria-hidden="true">…</span>
                  <button
                    v-else
                    type="button"
                    :class="['pg', 'tap', { on: item === page }]"
                    :disabled="searching"
                    :aria-current="item === page ? 'page' : undefined"
                    :aria-label="t('mods.catalog.pageNumber', { page: item })"
                    @click="goToPage(item)"
                  >{{ item }}</button>
                </template>
                <button type="button" class="pg tap" :disabled="page >= totalPages || searching" :aria-label="t('mods.catalog.nextPage')" @click="nextPage">
                  <i class="pi pi-angle-right" aria-hidden="true" />
                </button>
              </nav>
            </div>
          </template>
        </section>
      </div>
    </div>

    <div v-if="serverId && pendingCount > 0" class="pending-bar" role="status">
      <span class="stat-icon pending" aria-hidden="true"><i class="pi pi-clock" /></span>
      <span class="pending-text">
        <strong>{{ t("mods.summary.pending", { count: pendingCount }) }}</strong>
        <span class="small dim">{{ t("mods.pendingBar.note", { server: serverId }) }}</span>
      </span>
      <span class="pending-warn"><i class="pi pi-exclamation-triangle" aria-hidden="true" /> {{ t("mods.pendingBar.required") }}</span>
      <Button
        v-if="canRestart"
        class="tap pending-restart"
        icon="pi pi-refresh"
        :label="t('mods.restart')"
        :disabled="!serverStatus || serverActions.isRunning(serverId)"
        :loading="serverActions.isRunning(serverId)"
        @click="restartServer"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import Button from "primevue/button";
import Select from "primevue/select";
import InputText from "primevue/inputtext";
import Checkbox from "primevue/checkbox";
import { useNotify } from "../composables/useNotify";
import { apiErrorText } from "../utils/errorMessage";
import { SERVER_STATE_ROLE, StatusRole, type StatusInput } from "@mcbot/schema";
import { t, type MessageKey } from "../i18n";
import { absoluteStamp, relativeAge } from "../utils/time";
import type { InstalledMod, ModCompatMod, ModProjectDetail, ModSearchHit, ModVersion } from "../api";
import { useMods, ENVIRONMENT_LABEL } from "../composables/useMods";
import { useModCompat, type CompatFilter } from "../composables/useModCompat";
import { useInstalledMods, type RowAction, type RowOutcome } from "../composables/useInstalledMods";
import { useCapabilities } from "../composables/useCapabilities";
import { useConfirmAction } from "../composables/useConfirmAction";
import { useRowBusy } from "../composables/useRowBusy";
import { useServerStatus } from "../composables/useServerStatus";
import { useServerActions } from "../composables/useServerActions";
import ViewHeader from "../components/ui/ViewHeader.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import InlineError from "../components/ui/InlineError.vue";
import InlineBanner from "../components/ui/InlineBanner.vue";
import StaleBanner from "../components/ui/StaleBanner.vue";
import JobBlock from "../components/ui/JobBlock.vue";
import ResponsiveTable from "../components/ui/ResponsiveTable.vue";
import StatusChip from "../components/ui/StatusChip.vue";
import ModIcon from "../components/ui/ModIcon.vue";
import type { ResponsiveColumn } from "../components/ui/types";

const props = withDefaults(
  defineProps<{
    activeServer: string;
    /** Minecraft version from the URL (`?check=`) to run the upgrade check for. */
    check?: string;
    /** Result filter from the URL (`?filter=blockers` or `?filter=ready`). */
    filter?: string;
  }>(),
  { check: "", filter: "" },
);
const emit = defineEmits<{
  "update-route": [patch: { query: Record<string, string | undefined> }];
}>();

interface CheckRow {
  slug: string;
  name: string;
  iconUrl: string;
  installedVersion: string;
  result: ModCompatMod | undefined;
}

const PAGE = 20;
const INSTALLED_PAGE = 15;
const VERSIONS_SHOWN = 12;
const BLOCKER_ICONS = 6;
const SEARCH_DEBOUNCE_MS = 300;
const ORDER: Record<ModCompatMod["availability"], number> = { unavailable: 0, unknown: 1, available: 2 };
const CHIP: Record<ModCompatMod["availability"], { role: StatusRole; label: MessageKey }> = {
  available: { role: StatusRole.Online, label: "mods.check.ready" },
  unavailable: { role: StatusRole.Offline, label: "mods.check.noBuild" },
  // Unknown blocks an upgrade decision, so it reads as "needs a look", not as grey.
  unknown: { role: StatusRole.Degraded, label: "mods.check.unknown" },
};
const BUSY_LABEL: Record<RowAction, MessageKey> = {
  update: "mods.busy.update",
  remove: "mods.busy.remove",
  disable: "mods.busy.disable",
  enable: "mods.busy.enable",
};

const serverId = computed(() => props.activeServer);
const mods = useMods(() => props.activeServer);
const inst = useInstalledMods(mods);
const installs = useRowBusy<string>();
const status = useServerStatus();
const { can } = useCapabilities();
const confirmAction = useConfirmAction();
const toast = useNotify();
const canWrite = computed(() => can("mods:write", props.activeServer));
const canRestart = computed(() => can("server:control", props.activeServer));
const serverActions = useServerActions(() => status.refresh());

/** Mods changed since this page loaded; the running server only picks them up on a restart. */
const pendingCount = computed(() => inst.changedSinceLoad.size);

async function restartServer(): Promise<void> {
  const server = serverStatus.value;
  if (!server) return;
  const restarted = await serverActions.runAction(server, "restart");
  if (restarted && props.activeServer === server.id) inst.changedSinceLoad.clear();
}

const checkError = ref("");
const compat = useModCompat({
  api: {
    start: (v, refresh) => mods.compatStart(v, refresh),
    poll: (id) => mods.compatPoll(id),
    versions: () => mods.compatVersions(),
  },
  installedVersion: () => inst.installed.value?.gameVersion,
  onError: (text) => (checkError.value = text),
});

// ── Header ────────────────────────────────────────────────────────────────

const serverStatus = computed(() => status.servers.value.find((s) => s.id === props.activeServer) ?? null);
const serverRole = computed<StatusInput>(() => {
  const state = serverStatus.value?.state;
  return state ? SERVER_STATE_ROLE[state] : StatusRole.Unknown;
});
const playersOnline = computed(() => serverStatus.value?.players?.online ?? 0);

function capitalise(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

const lede = computed(() => {
  const list = inst.installed.value;
  const server = props.activeServer;
  const base =
    list?.modLoader && list.gameVersion
      ? t("mods.lede", { loader: capitalise(list.modLoader), version: list.gameVersion, server })
      : t("mods.ledeUnknown", { server });
  return playersOnline.value > 0 ? `${base} ${t("mods.ledePlayers", { count: playersOnline.value })}` : base;
});

const compatibleWith = computed(() => {
  const list = inst.installed.value;
  if (!list?.gameVersion) return t("mods.summary.versionUnknown");
  return list.modLoader
    ? t("mods.summary.withLoader", { version: list.gameVersion, loader: capitalise(list.modLoader) })
    : t("mods.summary.with", { version: list.gameVersion });
});

// ── Installed list ────────────────────────────────────────────────────────

type StatusFilter = "all" | "enabled" | "disabled" | "updates";
type InstalledSort = "name-asc" | "name-desc";

const installedQuery = ref("");
const statusFilter = ref<StatusFilter>("all");
const installedSort = ref<InstalledSort>("name-asc");
const installedPage = ref(1);
const selected = reactive(new Set<string>());
const bulkRunning = ref(false);

const statusOptions = computed<Array<{ value: StatusFilter; label: string }>>(() => [
  { value: "all", label: t("mods.installed.statusAll") },
  { value: "enabled", label: t("mods.installed.statusEnabled") },
  { value: "disabled", label: t("mods.installed.statusDisabled") },
  ...(inst.updateCount.value > 0
    ? [{ value: "updates" as const, label: `${t("mods.installed.onlyUpdates")} (${inst.updateCount.value})` }]
    : []),
]);
const installedSortOptions = computed<Array<{ value: InstalledSort; label: string }>>(() => [
  { value: "name-asc", label: t("mods.installed.sortNameAsc") },
  { value: "name-desc", label: t("mods.installed.sortNameDesc") },
]);

const installedColumns = computed<ResponsiveColumn[]>(() => [
  { key: "mod", label: t("mods.installed.colMod"), primary: true },
  { key: "version", label: t("mods.installed.colVersion") },
  { key: "status", label: t("mods.installed.colStatus") },
]);

const installedMeta = computed(() => {
  const list = inst.installed.value;
  if (!list) return "";
  const parts = [t("mods.installed.count", { count: list.mods.length })];
  if (inst.updateCount.value > 0) parts.push(t("mods.installed.updates", { count: inst.updateCount.value }));
  return parts.join(", ");
});

const visibleInstalled = computed(() => {
  const q = installedQuery.value.trim().toLowerCase();
  const filter = statusFilter.value;
  const list = inst.mods.value.filter((m) => {
    if (filter === "updates" && !inst.hasUpdate(m.slug)) return false;
    if (filter === "enabled" && m.enabled === false) return false;
    if (filter === "disabled" && m.enabled !== false) return false;
    if (!q) return true;
    return (
      m.slug.toLowerCase().includes(q) ||
      (m.filename ?? "").toLowerCase().includes(q) ||
      nameOf(m).toLowerCase().includes(q)
    );
  });
  const dir = installedSort.value === "name-asc" ? 1 : -1;
  return list.sort((a, b) => dir * nameOf(a).localeCompare(nameOf(b)));
});

const installedPages = computed(() => Math.max(1, Math.ceil(visibleInstalled.value.length / INSTALLED_PAGE)));
const pagedInstalled = computed(() => {
  const start = (installedPage.value - 1) * INSTALLED_PAGE;
  return visibleInstalled.value.slice(start, start + INSTALLED_PAGE);
});
const pageFrom = computed(() => (visibleInstalled.value.length === 0 ? 0 : (installedPage.value - 1) * INSTALLED_PAGE + 1));
const pageTo = computed(() => (installedPage.value - 1) * INSTALLED_PAGE + pagedInstalled.value.length);

watch(inst.updateCount, (n) => {
  if (n === 0 && statusFilter.value === "updates") statusFilter.value = "all";
});
watch([installedQuery, statusFilter, installedSort], () => {
  installedPage.value = 1;
});
watch(installedPages, (pages) => {
  if (installedPage.value > pages) installedPage.value = pages;
});
watch(inst.mods, (list) => {
  const slugs = new Set(list.map((m) => m.slug));
  for (const slug of [...selected]) if (!slugs.has(slug)) selected.delete(slug);
});

const allPageSelected = computed(
  () => pagedInstalled.value.length > 0 && pagedInstalled.value.every((m) => selected.has(m.slug)),
);

function toggleSelected(slug: string): void {
  if (selected.has(slug)) selected.delete(slug);
  else selected.add(slug);
}

function togglePage(): void {
  const select = !allPageSelected.value;
  for (const m of pagedInstalled.value) {
    if (select) selected.add(m.slug);
    else selected.delete(m.slug);
  }
}

async function bulkDisable(): Promise<void> {
  if (bulkRunning.value) return;
  bulkRunning.value = true;
  try {
    for (const m of inst.mods.value.filter((x) => selected.has(x.slug) && x.enabled !== false)) {
      const outcome = await inst.runRow(m.slug, "disable", t(BUSY_LABEL.disable));
      report("disable", nameOf(m), outcome);
      if (outcome.ok) selected.delete(m.slug);
    }
  } finally {
    bulkRunning.value = false;
  }
}

async function bulkRemove(): Promise<void> {
  if (bulkRunning.value) return;
  const targets = inst.mods.value.filter((m) => selected.has(m.slug));
  if (targets.length === 0) return;
  const server = props.activeServer;
  const count = targets.length;
  const result = await confirmAction({
    level: "disruptive",
    levelLabel: t("mods.remove.level"),
    tone: "danger",
    header: t("mods.bulk.removeHeader", { count, server }),
    message: t("mods.bulk.removeMessage", { count }),
    acceptLabel: t("mods.bulk.removeAccept", { count }),
    cancelLabel: t("mods.bulk.removeCancel"),
    facts: [
      { term: t("mods.remove.factFile"), detail: targets.map((m) => nameOf(m)).join(", ") },
      { term: t("mods.remove.factRecover"), detail: t("mods.bulk.removeRecover") },
    ],
  });
  if (result !== "confirm" || props.activeServer !== server) return;
  bulkRunning.value = true;
  try {
    for (const m of targets) {
      const outcome = await inst.runRow(m.slug, "remove", t(BUSY_LABEL.remove));
      report("remove", nameOf(m), outcome);
      if (outcome.ok) selected.delete(m.slug);
    }
    void runSearch();
  } finally {
    bulkRunning.value = false;
  }
}

const loadErrorDetail = computed(() => {
  const err = inst.loadError.value;
  if (!err) return "";
  const outcome = err.status !== null ? String(err.status) : err.message || "no response";
  return `GET /api/servers/${props.activeServer}/mods/installed -> ${outcome}`;
});

/** The compat check knows a project's display name; the installed list only has the slug. */
function nameOf(m: { slug: string; name?: string }): string {
  return m.name || compat.forSlug(m.slug)?.name || m.slug;
}

function iconOf(slug: string, own?: string): string {
  return own || inst.mods.value.find((m) => m.slug === slug)?.iconUrl || "";
}

function modrinthUrl(slug: string): string {
  return `https://modrinth.com/mod/${encodeURIComponent(slug)}`;
}

function statusOf(m: InstalledMod): { state: StatusInput; label: string; busy?: boolean } {
  if (inst.isBusy(m.slug)) return { state: StatusRole.Info, label: inst.busyLabel(m.slug), busy: true };
  if (inst.changedSinceLoad.has(m.slug)) return { state: StatusRole.Pending, label: t("mods.installed.statusChanged") };
  if (m.enabled === false) return { state: StatusRole.Unknown, label: t("mods.installed.statusDisabled") };
  if (inst.hasUpdate(m.slug)) return { state: StatusRole.Info, label: t("mods.installed.statusUpdate") };
  return { state: StatusRole.Applied, label: t("mods.installed.statusUpToDate") };
}

function notify(ok: boolean, summary: string, detail: string): void {
  if (ok) toast.ok(summary, detail);
  else toast.fail(summary, detail);
}

const FAILED: Record<RowAction, MessageKey> = {
  update: "mods.toast.updateFailed",
  remove: "mods.toast.removeFailed",
  disable: "mods.toast.toggleFailed",
  enable: "mods.toast.toggleFailed",
};

function report(action: RowAction, name: string, outcome: RowOutcome): void {
  if (!outcome.ok) {
    if (outcome.error || outcome.changed === 0) {
      notify(false, t(FAILED[action]), `${name}: ${outcome.error || t("mods.toast.noDetail")}`);
    }
    return;
  }
  const restart = t("mods.toast.restartNote", { server: props.activeServer });
  if (action === "update") {
    if (outcome.changed > 0) notify(true, t("mods.toast.updated", { name }), restart);
    else notify(true, t("mods.toast.upToDate", { name }), "");
  } else if (action === "remove") notify(true, t("mods.toast.removed", { name }), restart);
  else if (action === "disable") notify(true, t("mods.toast.disabled", { name }), restart);
  else notify(true, t("mods.toast.enabled", { name }), restart);
}

async function act(m: InstalledMod, action: RowAction): Promise<void> {
  if (inst.isLocked(m.slug)) return;
  const name = nameOf(m);
  const outcome = await inst.runRow(m.slug, action, t(BUSY_LABEL[action]));
  report(action, name, outcome);
  if (outcome.ok && (action === "remove" || action === "update")) void runSearch();
}

async function confirmRemove(m: InstalledMod): Promise<void> {
  const name = nameOf(m);
  const server = props.activeServer;
  const players = playersOnline.value;
  const result = await confirmAction({
    level: "disruptive",
    levelLabel: t("mods.remove.level"),
    tone: "danger",
    header: t("mods.remove.header", { name, server }),
    message: t("mods.remove.message"),
    acceptLabel: t("mods.remove.accept", { name }),
    cancelLabel: t("mods.remove.cancel", { name }),
    media: { name, slug: m.slug, src: m.iconUrl ?? "" },
    facts: [
      ...(m.filename ? [{ term: t("mods.remove.factFile"), detail: m.filename, mono: true }] : []),
      {
        term: t("mods.remove.factEffect"),
        detail: players > 0 ? t("mods.remove.effectPlayers", { name, count: players }) : t("mods.remove.effect", { name }),
      },
      { term: t("mods.remove.factRecover"), detail: t("mods.remove.recover", { name }) },
    ],
  });
  if (result !== "confirm" || props.activeServer !== server) return;
  await act(m, "remove");
}

async function applyAll(): Promise<void> {
  const outcome = await inst.applyAll();
  if (!outcome.ok) {
    notify(false, t("mods.toast.updateFailed"), outcome.error || t("mods.toast.noDetail"));
    return;
  }
  if (outcome.changed > 0) {
    notify(true, t("mods.toast.updatedAll", { count: outcome.changed }), t("mods.toast.restartNote", { server: props.activeServer }));
  } else {
    notify(true, t("mods.toast.allUpToDate"), "");
  }
}

// ── Upgrade check ─────────────────────────────────────────────────────────

const versionOptions = computed(() =>
  compat.versionChoices.value.map((v) => ({
    value: v,
    label: v === inst.installed.value?.gameVersion ? t("mods.check.installedSuffix", { version: v }) : v,
  })),
);

/** The check group, unless there is nothing to check and no check to show. */
const showCheck = computed(
  () =>
    !!inst.installed.value?.compat &&
    (inst.mods.value.length > 0 || compat.checkedVersion.value !== null || compat.checkingCompat.value),
);

const checkButtonLabel = computed(() =>
  compat.targetValid.value
    ? t("mods.check.button", { count: inst.mods.value.length, version: compat.targetVersion.value })
    : t("mods.check.buttonNoVersion"),
);

const checkVersionShown = computed(() => compat.checkedVersion.value ?? compat.targetVersion.value);

const progressTitle = computed(() => {
  const p = compat.job.value?.progress;
  if (!p || p.total === 0) return t("mods.check.starting", { version: checkVersionShown.value });
  return t("mods.check.progress", { done: Math.min(p.done, p.total), total: p.total });
});

/** A finished job that failed, or a start or poll that failed before any job answered. */
const checkFailed = computed(
  () =>
    compat.failed.value ||
    (!!checkError.value && compat.checkedVersion.value !== null && !compat.checkingCompat.value && !compat.hasResult.value),
);
const failureText = computed(
  () => compat.job.value?.error || checkError.value || t("mods.check.failedNoReason"),
);
/** Problems outside a check, such as the version list not loading. */
const checkNotice = computed(() => (checkFailed.value ? "" : checkError.value));

const checkedAtText = computed(() => {
  const at = compat.job.value?.checkedAt;
  if (!compat.hasResult.value || !at || compat.stale.value) return "";
  return t("mods.check.checkedAt", { version: checkVersionShown.value, time: absoluteStamp(at) });
});

const summary = computed(
  () => compat.summary.value ?? { available: 0, unavailable: 0, unknown: 0, total: 0 },
);
const blockerCount = computed(() => summary.value.unavailable + summary.value.unknown);

const verdictText = computed(() => {
  const version = checkVersionShown.value;
  if (blockerCount.value === 0) return t("mods.check.readyText", { version });
  const parts: string[] = [];
  if (summary.value.unavailable > 0) parts.push(t("mods.check.blockedMissing", { count: summary.value.unavailable, version }));
  if (summary.value.unknown > 0) parts.push(t("mods.check.blockedUnknown", { count: summary.value.unknown }));
  parts.push(t("mods.check.blockedAdvice"));
  return parts.join(" ");
});

function installedVersionOf(slug: string): string {
  return inst.mods.value.find((m) => m.slug === slug)?.versionId ?? "";
}

function toCheckRow(slug: string, result: ModCompatMod | undefined, name?: string): CheckRow {
  return {
    slug,
    name: name || result?.name || nameOf({ slug }),
    iconUrl: iconOf(slug, result?.iconUrl),
    installedVersion: installedVersionOf(slug),
    result,
  };
}

const allResults = computed<CheckRow[]>(() =>
  [...compat.rows.value]
    .sort((a, b) => ORDER[a.availability] - ORDER[b.availability] || nameOf(a).localeCompare(nameOf(b)))
    .map((r) => toCheckRow(r.slug, r)),
);
const blockerRows = computed(() =>
  compat.rows.value
    .filter((r) => r.availability !== "available")
    .sort((a, b) => ORDER[a.availability] - ORDER[b.availability]),
);
const visibleResults = computed(() => {
  const f = compat.filter.value;
  if (f === "blockers") return allResults.value.filter((r) => r.result?.availability !== "available");
  if (f === "ready") return allResults.value.filter((r) => r.result?.availability === "available");
  return allResults.value;
});
const resultFilters = computed<Array<{ key: CompatFilter; label: string; count: number }>>(() => [
  { key: "all", label: t("mods.check.filterAll"), count: allResults.value.length },
  { key: "blockers", label: t("mods.check.filterBlockers"), count: blockerCount.value },
  { key: "ready", label: t("mods.check.filterReady"), count: summary.value.available },
]);
const progressRows = computed<CheckRow[]>(() =>
  inst.mods.value.map((m) => toCheckRow(m.slug, compat.forSlug(m.slug), nameOf(m))),
);

const checkColumns = computed<ResponsiveColumn[]>(() => [
  { key: "mod", label: t("mods.installed.colMod"), primary: true },
  { key: "installed", label: t("mods.check.colInstalled") },
  { key: "at", label: t("mods.check.colAt", { version: checkVersionShown.value }) },
  { key: "detail", label: t("mods.check.colDetail") },
]);
const resultColumns = checkColumns;

function detailOf(r: ModCompatMod): string {
  if (r.availability === "available") {
    return r.target
      ? t("mods.check.detailBuild", { name: r.target.versionName })
      : t("mods.check.detailNewest", { version: checkVersionShown.value });
  }
  return r.reason || t("mods.check.detailNoReason");
}

/** What a finished check was computed from: slug, build and enabled state. */
function installedSignature(list: InstalledMod[]): string {
  return list
    .map((m) => `${m.slug}:${m.versionId ?? ""}:${m.enabled === false ? 0 : 1}`)
    .sort()
    .join("|");
}
let checkedSignature = "";

function runCheck(refresh: boolean): Promise<void> {
  checkError.value = "";
  checkedSignature = installedSignature(inst.mods.value);
  return compat.check(refresh);
}

function startCheck(refresh = false): Promise<void> {
  compat.filter.value = "blockers";
  return runCheck(refresh);
}

function closeResults(): void {
  compat.reset();
  checkError.value = "";
}

async function copyBlockers(): Promise<void> {
  const lines = blockerRows.value.map((r) => `${nameOf(r)} (${t(CHIP[r.availability].label)})`);
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    toast.ok(t("mods.check.copied"));
  } catch {
    toast.warn(t("mods.check.copyFailed"));
  }
}

watch(inst.mods, (next) => {
  if (compat.hasResult.value && installedSignature(next) !== checkedSignature) compat.markStale();
});

function routeFilter(value: string): CompatFilter {
  return value === "blockers" || value === "ready" ? value : "all";
}

/** Runs the check the URL names, once the installed list says checks are possible. */
async function applyRouteCheck(): Promise<void> {
  if (!props.check || !inst.installed.value?.compat || compat.checkingCompat.value) return;
  if (compat.versionChoices.value.includes(props.check)) {
    compat.useCustom.value = false;
    compat.selected.value = props.check;
  } else {
    compat.useCustom.value = true;
    compat.customVersion.value = props.check;
  }
  compat.filter.value = routeFilter(props.filter);
  await runCheck(false);
}

watch(
  () => props.check,
  (version) => {
    if (version && version !== compat.checkedVersion.value) void applyRouteCheck();
  },
);
watch(
  () => props.filter,
  (value) => {
    if (compat.hasResult.value) compat.filter.value = routeFilter(value);
  },
);
watch([compat.checkedVersion, compat.filter], ([version, filter]) => {
  const check = version ?? "";
  const shownFilter = version && filter !== "all" ? filter : "";
  if (check === props.check && shownFilter === props.filter) return;
  emit("update-route", { query: { check: check || undefined, filter: shownFilter || undefined } });
});

// ── Catalogue ─────────────────────────────────────────────────────────────

const catalogSearch = ref<{ $el?: HTMLElement } | null>(null);
const query = ref("");
const sort = ref("relevance");
const compatible = ref(true);
const hideClientOnly = ref(true);
const results = ref<ModSearchHit[]>([]);
const total = ref(0);
const searching = ref(false);
const searchError = ref("");
/** False until the first search for this server answered, so nothing reads as "no results" early. */
const searched = ref(false);
const offset = ref(0);
const page = computed(() => Math.floor(offset.value / PAGE) + 1);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE)));

/** First page, last page and a window around the current one, with gaps between. */
const pageItems = computed<Array<number | "gap">>(() => {
  const last = totalPages.value;
  const wanted = new Set([1, last]);
  for (let n = page.value - 1; n <= page.value + 1; n++) if (n > 1 && n < last) wanted.add(n);
  const items: Array<number | "gap"> = [];
  let prev = 0;
  for (const n of [...wanted].sort((a, b) => a - b)) {
    if (n - prev === 2) items.push(prev + 1);
    else if (n - prev > 2) items.push("gap");
    items.push(n);
    prev = n;
  }
  return items;
});

function goToPage(n: number): void {
  if (n === page.value) return;
  offset.value = (n - 1) * PAGE;
  void runSearch();
}

const openSlug = ref<string | null>(null);
const detail = ref<ModProjectDetail | null>(null);
const loadingDetail = ref(false);
const detailError = ref("");

const sortOptions = computed(() => [
  { value: "relevance", label: t("mods.catalog.sortRelevance") },
  { value: "downloads", label: t("mods.catalog.sortDownloads") },
  { value: "follows", label: t("mods.catalog.sortFollows") },
  { value: "newest", label: t("mods.catalog.sortNewest") },
  { value: "updated", label: t("mods.catalog.sortUpdated") },
]);

const catalogMeta = computed(() => {
  const list = inst.installed.value;
  if (!compatible.value || !list?.modLoader || !list.gameVersion) return t("mods.catalog.metaAny");
  return `${capitalise(list.modLoader)}, ${list.gameVersion}`;
});
const compatibleLabel = computed(() => {
  const version = inst.installed.value?.gameVersion;
  return version ? t("mods.catalog.compatible", { version }) : t("mods.catalog.compatibleAny");
});

const compactNumber = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
function compact(n: number): string {
  return compactNumber.format(n);
}

function pickerId(slug: string): string {
  return `mods-picker-${slug.replace(/[^\w-]/g, "-")}`;
}

function versionTypeLabel(type: string): string {
  if (type === "beta") return t("mods.catalog.beta");
  if (type === "alpha") return t("mods.catalog.alpha");
  return t("mods.catalog.release");
}

function versionMeta(v: ModVersion): string {
  const parts = [v.gameVersions[0] ?? "", v.loaders.map(capitalise).join(", ")].filter(Boolean);
  if (v.datePublished) {
    parts.push(new Date(v.datePublished).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }));
  }
  return parts.join(", ");
}

async function focusCatalog(): Promise<void> {
  await nextTick();
  const el = catalogSearch.value?.$el;
  el?.scrollIntoView({ block: "center" });
  el?.focus();
}

let searchTimer: number | undefined;
let searchSeq = 0;
function onQueryInput(): void {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(resetSearch, SEARCH_DEBOUNCE_MS);
}

function resetSearch(): Promise<void> {
  offset.value = 0;
  return runSearch();
}
function toggleCompatible(): void {
  compatible.value = !compatible.value;
  void resetSearch();
}
function toggleClientOnly(): void {
  hideClientOnly.value = !hideClientOnly.value;
  void resetSearch();
}
function nextPage(): void {
  if (offset.value + PAGE >= total.value) return;
  offset.value += PAGE;
  void runSearch();
}
function prevPage(): void {
  offset.value = Math.max(0, offset.value - PAGE);
  void runSearch();
}

async function runSearch(): Promise<void> {
  if (!props.activeServer) return;
  const mine = ++searchSeq;
  searching.value = true;
  openSlug.value = null;
  try {
    const res = await mods.search({
      query: query.value,
      sort: sort.value,
      compatible: compatible.value,
      hideClientOnly: hideClientOnly.value,
      limit: PAGE,
      offset: offset.value,
    });
    if (mine !== searchSeq) return;
    results.value = res.hits;
    total.value = res.totalHits;
    searchError.value = "";
  } catch (err) {
    if (mine !== searchSeq) return;
    results.value = [];
    total.value = 0;
    searchError.value = apiErrorText(err, "no response");
  } finally {
    if (mine === searchSeq) {
      searching.value = false;
      searched.value = true;
    }
  }
}

async function loadDetail(hit: ModSearchHit): Promise<void> {
  detail.value = null;
  detailError.value = "";
  loadingDetail.value = true;
  try {
    const next = await mods.catalog(hit.slug);
    if (openSlug.value === hit.slug) detail.value = next;
  } catch (err) {
    if (openSlug.value === hit.slug) detailError.value = apiErrorText(err, "no response");
  } finally {
    loadingDetail.value = false;
  }
}

function toggleVersions(hit: ModSearchHit): void {
  if (openSlug.value === hit.slug) {
    openSlug.value = null;
    return;
  }
  openSlug.value = hit.slug;
  void loadDetail(hit);
}

async function install(hit: ModSearchHit, v?: ModVersion): Promise<void> {
  if (installs.isLocked(hit.slug)) return;
  const name = hit.title || hit.slug;
  const server = props.activeServer;
  await installs.run(
    hit.slug,
    async () => {
      try {
        const r = await mods.install({
          slug: hit.slug,
          ...(v?.gameVersions[0] ? { mcVersion: v.gameVersions[0] } : {}),
          ...(v ? { versionId: v.id } : {}),
        });
        if (!r.ok) {
          notify(false, t("mods.toast.installFailed"), `${name}: ${r.error || t("mods.toast.noDetail")}`);
          return;
        }
        const deps = r.dependencies?.length ?? 0;
        notify(
          true,
          deps > 0 ? t("mods.toast.installedDeps", { name, count: deps }) : t("mods.toast.installed", { name }),
          t("mods.toast.restartNote", { server }),
        );
        if (r.slug) inst.changedSinceLoad.add(r.slug);
        openSlug.value = null;
        if (props.activeServer === server) {
          await Promise.all([inst.load(), inst.refreshUpdates(true), runSearch()]);
        }
      } catch (err) {
        notify(false, t("mods.toast.installFailed"), `${name}: ${apiErrorText(err, t("mods.toast.noDetail"))}`);
      }
    },
    { label: t("mods.busy.install") },
  );
}

// ── Lifecycle ─────────────────────────────────────────────────────────────

async function reload(): Promise<void> {
  if (!props.activeServer) return;
  void status.refresh();
  await inst.load();
  await Promise.all([inst.refreshUpdates(false), runSearch()]);
  if (inst.installed.value?.compat && compat.releases.value.length === 0) await compat.loadVersions();
  await applyRouteCheck();
}

onMounted(reload);
watch(
  () => props.activeServer,
  () => {
    compat.reset();
    checkError.value = "";
    compat.selected.value = "";
    inst.reset();
    installedQuery.value = "";
    statusFilter.value = "all";
    selected.clear();
    openSlug.value = null;
    searched.value = false;
    results.value = [];
    return reload();
  },
);
onBeforeUnmount(() => {
  window.clearTimeout(searchTimer);
  compat.dispose();
});
</script>

<style scoped>
.mods-view { container-type: inline-size; min-width: 0; }

.mods-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-5); align-items: start; }
.mods-main, .mods-catalog { display: grid; gap: var(--space-4); min-width: 0; align-content: start; }
@container (min-width: 1100px) {
  .mods-layout { grid-template-columns: minmax(0, 1fr) minmax(380px, 460px); }
}

.summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3) var(--space-5);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  background: var(--surface-nav);
}
.stat { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.stat + .stat { padding-inline-start: var(--space-5); border-inline-start: 1px solid var(--border); }
.stat-icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-surface);
  background: var(--surface-raised);
  color: var(--accent);
  font-size: var(--text-lg);
}
.stat-icon.ok { background: var(--accent-tint); color: var(--st-online); }
.stat-icon.pending { background: var(--st-degraded-bg); color: var(--st-degraded); }
.stat-text { display: grid; min-width: 0; line-height: var(--leading-tight); }
.stat-n { font-size: var(--text-lg); font-weight: 600; font-variant-numeric: tabular-nums; }
.stat-l { color: var(--text-dim); font-size: var(--text-sm); }
.summary-add { margin-inline-start: auto; }
@container (max-width: 760px) {
  .stat + .stat { padding-inline-start: 0; border-inline-start: 0; }
  .summary-add { margin-inline-start: 0; width: 100%; }
}

.filter-select { min-width: 160px; }
.bulk {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2) var(--space-3);
  margin-bottom: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--accent);
  border-radius: var(--radius-control);
  background: var(--accent-tint);
}
.bulk-count { font-size: var(--text-sm); font-weight: 600; }

.pager { display: inline-flex; flex-wrap: wrap; gap: var(--space-1); }
.pg {
  min-width: 32px;
  min-height: 32px;
  padding: 0 var(--space-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.pg:hover:not(:disabled) { background: var(--surface); border-color: var(--border-hover); }
.pg.on { background: var(--accent-tint); border-color: var(--accent); }
.pg:disabled { opacity: 0.45; cursor: default; }
.pg.on:disabled { opacity: 1; }
.pg-gap { display: inline-flex; align-items: center; padding: 0 var(--space-1); color: var(--text-dim); }

.catalog-lede { margin: calc(-1 * var(--space-2)) 0 var(--space-3); color: var(--text-dim); font-size: var(--text-sm); }

.has-pending { padding-bottom: var(--space-2); }
.pending-bar {
  position: sticky;
  bottom: var(--space-3);
  z-index: var(--z-sticky);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-4);
  margin-top: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--accent);
  border-radius: var(--radius-surface);
  background: var(--surface-nav);
  box-shadow: var(--shadow-overlay);
}
.pending-text { display: grid; flex: 1 1 240px; min-width: 0; }
.pending-warn { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--st-degraded); font-size: var(--text-sm); }
.pending-restart { margin-inline-start: auto; }
@container (min-width: 1900px) {
  .mods-layout { grid-template-columns: minmax(0, 1fr) minmax(0, 900px); }
  .cat { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cat-item:nth-child(2) { border-top: 0; }
  .cat-item:nth-child(even) { border-left: 1px solid var(--border); }
}

.card-meta { color: var(--text-dim); font-size: var(--text-sm); flex: 1 1 auto; }
.cluster { display: inline-flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.small { font-size: var(--text-sm); }
.mono { font-family: var(--font-mono); }
.caps {
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--text-dim);
}

.check {
  display: grid;
  gap: var(--space-3);
  margin: 0 calc(-1 * var(--space-4)) var(--space-3);
  padding: var(--space-3) var(--space-4) var(--space-4);
  border-bottom: 1px solid var(--border);
}
.check p { margin: 0; }
.check-row { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--space-3) var(--space-4); }
.check-field { display: grid; gap: var(--space-1); min-width: 180px; }
.check-field label { font-size: var(--text-sm); color: var(--text-dim); }
.check-select, .check-input { min-width: 180px; }
.failure { overflow-wrap: anywhere; }
.nothing-changed { align-self: center; }

.check-results {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-4) var(--space-5);
  align-items: start;
}
@container (min-width: 760px) {
  .check-results { grid-template-columns: minmax(0, 420px) minmax(0, 1fr); }
}
.minimeter { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-3); }
.metric {
  display: grid;
  gap: 2px;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border);
  border-left: 3px solid var(--metric-edge, var(--border));
  border-radius: var(--radius-surface);
  background: var(--surface);
}
.metric-ready { --metric-edge: var(--st-online); }
.metric-missing { --metric-edge: var(--st-offline); }
.metric-unknown { --metric-edge: var(--st-degraded); }
.metric-n { font-size: var(--text-3xl); font-weight: 600; line-height: var(--leading-tight); font-variant-numeric: tabular-nums; }
.metric-l { font-size: var(--text-sm); color: var(--text-dim); }
.blockers { display: grid; gap: var(--space-2); }
.iconstrip { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
.iconstrip .more { font-size: var(--text-sm); color: var(--text-dim); }

.subhead {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-4);
  margin-bottom: var(--space-3);
}
.subhead h3 { margin: 0; font-size: var(--text-lg); font-weight: 600; }

.notices { display: grid; gap: var(--space-3); margin-bottom: var(--space-3); }
.notices:empty { display: none; }
.notices :deep(.stale-banner) { margin-bottom: 0; }

.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-bottom: var(--space-3); }
.search { position: relative; flex: 1 1 220px; min-width: 0; }
.search .pi { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-dim); pointer-events: none; }
.search :deep(input) { width: 100%; padding-left: 36px; }
.sort { display: inline-flex; align-items: center; gap: var(--space-2); }


.modcell { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.modcell.off { opacity: 0.7; }
.modcell-text { display: grid; min-width: 0; }
.name { font-weight: 600; overflow-wrap: anywhere; }
.sub {
  display: block;
  max-width: 34ch;
  overflow: hidden;
  color: var(--text-dim);
  font-size: var(--text-xs);
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.version { font-size: var(--text-xs); white-space: nowrap; }
.detail { overflow-wrap: anywhere; }
.row-actions { flex-wrap: nowrap; justify-content: flex-end; }
.row-busy { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--st-info); font-size: var(--text-sm); }
.icon-link, .link-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  border-radius: var(--radius-control);
  color: var(--text-dim);
  text-decoration: none;
}
.icon-link { width: 32px; }
.link-btn {
  padding: 0 var(--space-3);
  border: 1px solid var(--border-strong);
  color: var(--text);
  font-size: var(--text-sm);
  white-space: nowrap;
}
.icon-link:hover, .link-btn:hover { background: var(--surface-raised); color: var(--text); }
.none-in-filter { margin: var(--space-3) 0; }

.skeleton { display: flex; flex-direction: column; gap: var(--space-3); }
.sk-row { display: flex; align-items: center; gap: var(--space-3); }
.sk-tile { flex: none; width: 36px; height: 36px; border-radius: var(--radius-control); background: var(--surface-raised); }
.sk-lines { flex: 1; display: grid; gap: var(--space-2); }
.sk-lines span { height: 10px; border-radius: var(--radius-full); background: var(--surface-raised); }
.sk-lines span:first-child { width: 45%; }
.sk-lines span:last-child { width: 85%; opacity: 0.6; }


.cat { list-style: none; margin: 0 calc(-1 * var(--space-4)); padding: 0; }
.cat-item { border-top: 1px solid var(--border); }
.cat-item:first-child { border-top: 0; }
.cat-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-3) var(--space-4);
}
.cat-body { min-width: 0; }
.cat-title { display: flex; flex-wrap: wrap; gap: 0 var(--space-2); align-items: baseline; }
.cat-title a { color: var(--text); font-weight: 600; text-underline-offset: 2px; overflow-wrap: anywhere; }
.cat-by { font-size: var(--text-xs); color: var(--text-dim); }
.cat-desc {
  margin: 2px 0 0;
  font-size: var(--text-sm);
  color: var(--text-dim);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.cat-meta { display: flex; flex-wrap: wrap; gap: 0 var(--space-3); margin-top: 2px; font-size: var(--text-xs); color: var(--text-dim); }

.picker {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--border);
  background: var(--surface-raised);
}
.picker p { margin: 0; }
.picker-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2) var(--space-3); }
.picker-title { display: inline-flex; align-items: center; gap: var(--space-2); }
.vrow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-1) var(--space-3);
  align-items: center;
  padding: var(--space-2) 0;
  border-top: 1px solid var(--border);
}
.vinfo { display: grid; min-width: 0; }
.vinfo strong { overflow-wrap: anywhere; }
.vmeta { font-size: var(--text-xs); color: var(--text-dim); }
.tag {
  display: inline-block;
  padding: 2px var(--space-2);
  border-radius: var(--radius-control);
  background: var(--surface);
  color: var(--text-dim);
  font-size: var(--text-xs);
  white-space: nowrap;
}
.tag-beta { background: var(--st-degraded-bg); color: var(--st-degraded); }


@media (max-width: 760px) {
  .cat-row { grid-template-columns: auto minmax(0, 1fr); }
  .cat-row > .cat-action { grid-column: 1 / -1; }
  .cat-title a { display: inline-flex; align-items: center; min-height: var(--touch-min); }
  .check-row > * { flex: 1 1 100%; }
  .check-select, .check-input { width: 100%; }
  .metric { padding: var(--space-3); }
  .metric-n { font-size: var(--text-2xl); }
  .vrow { grid-template-columns: minmax(0, 1fr); }
}
@media (pointer: coarse), (max-width: 760px) {
  .icon-link, .link-btn { min-height: var(--touch-min); }
  .icon-link { width: var(--touch-min); }
}
</style>
