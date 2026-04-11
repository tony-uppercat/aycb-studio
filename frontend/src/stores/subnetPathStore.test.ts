import { describe, it, expect, beforeEach } from 'vitest'
import { useSubnetPathStore } from './subnetPathStore'

describe('subnetPathStore', () => {
  beforeEach(() => {
    useSubnetPathStore.getState().reset()
  })

  it('starts empty (at root)', () => {
    expect(useSubnetPathStore.getState().current_path).toEqual([])
  })

  it('enter pushes subnet id onto path', () => {
    useSubnetPathStore.getState().enter('subnet-a')
    expect(useSubnetPathStore.getState().current_path).toEqual(['subnet-a'])
    useSubnetPathStore.getState().enter('subnet-b')
    expect(useSubnetPathStore.getState().current_path).toEqual(['subnet-a', 'subnet-b'])
  })

  it('exit pops one level', () => {
    useSubnetPathStore.getState().enter('subnet-a')
    useSubnetPathStore.getState().enter('subnet-b')
    useSubnetPathStore.getState().exit()
    expect(useSubnetPathStore.getState().current_path).toEqual(['subnet-a'])
  })

  it('exit at root is a no-op', () => {
    useSubnetPathStore.getState().exit()
    expect(useSubnetPathStore.getState().current_path).toEqual([])
  })

  it('goto truncates path to given depth', () => {
    useSubnetPathStore.getState().enter('a')
    useSubnetPathStore.getState().enter('b')
    useSubnetPathStore.getState().enter('c')
    useSubnetPathStore.getState().goto(1)
    expect(useSubnetPathStore.getState().current_path).toEqual(['a'])
  })

  it('goto(0) is equivalent to reset', () => {
    useSubnetPathStore.getState().enter('a')
    useSubnetPathStore.getState().goto(0)
    expect(useSubnetPathStore.getState().current_path).toEqual([])
  })

  it('goto with out-of-range depth is a no-op', () => {
    useSubnetPathStore.getState().enter('a')
    useSubnetPathStore.getState().goto(5)
    expect(useSubnetPathStore.getState().current_path).toEqual(['a'])
    useSubnetPathStore.getState().goto(-1)
    expect(useSubnetPathStore.getState().current_path).toEqual(['a'])
  })

  it('reset clears the path', () => {
    useSubnetPathStore.getState().enter('a')
    useSubnetPathStore.getState().enter('b')
    useSubnetPathStore.getState().reset()
    expect(useSubnetPathStore.getState().current_path).toEqual([])
  })
})
