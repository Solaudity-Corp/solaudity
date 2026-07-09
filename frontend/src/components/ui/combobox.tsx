'use client'
import { Combobox } from '@ark-ui/react/combobox'
import { createStyleContext } from 'styled-system/jsx'
import { combobox } from 'styled-system/recipes'

const { withProvider, withContext } = createStyleContext(combobox)

// `withProvider` erases Combobox.Root's generic (collection item -> unknown),
// which makes `collection={ListCollection<OurItem>}` fail on variance. Re-cast
// the styled wrapper back to Ark's generic Root signature; the runtime wrapper
// still provides the slot-recipe context consumed by the children below.
export const Root = withProvider(Combobox.Root, 'root') as unknown as typeof Combobox.Root
export const ClearTrigger = withContext(Combobox.ClearTrigger, 'clearTrigger')
export const Content = withContext(Combobox.Content, 'content')
export const Control = withContext(Combobox.Control, 'control')
export const Input = withContext(Combobox.Input, 'input')
export const Item = withContext(Combobox.Item, 'item')
export const ItemGroup = withContext(Combobox.ItemGroup, 'itemGroup')
export const ItemGroupLabel = withContext(Combobox.ItemGroupLabel, 'itemGroupLabel')
export const ItemIndicator = withContext(Combobox.ItemIndicator, 'itemIndicator')
export const ItemText = withContext(Combobox.ItemText, 'itemText')
export const Label = withContext(Combobox.Label, 'label')
export const List = withContext(Combobox.List, 'list')
export const Positioner = withContext(Combobox.Positioner, 'positioner')
export const Trigger = withContext(Combobox.Trigger, 'trigger')

// eslint-disable-next-line react-refresh/only-export-components -- re-export includes the createListCollection helper alongside the context component
export { ComboboxContext as Context, createListCollection } from '@ark-ui/react/combobox'
